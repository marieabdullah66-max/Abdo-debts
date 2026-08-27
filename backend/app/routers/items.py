from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from openpyxl import load_workbook

from ..core import ItemInput, current_profile, require_permission, sb

router = APIRouter(prefix="/api/items", tags=["items"])

MAX_EXCEL_BYTES = 12 * 1024 * 1024
MAX_PREVIEW_ROWS = 20
MAX_PREVIEW_COLS = 30


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value)).strip()
    return str(value).strip()


def _parse_units(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0 or int(number) != number:
        return None
    return int(number)


async def _read_excel_bytes(file: UploadFile) -> bytes:
    name = (file.filename or "").lower()
    if not name.endswith(".xlsx"):
        raise HTTPException(422, "الاستيراد الحالي يدعم ملفات Excel بصيغة .xlsx فقط")
    content = await file.read(MAX_EXCEL_BYTES + 1)
    if len(content) > MAX_EXCEL_BYTES:
        raise HTTPException(413, "حجم ملف Excel أكبر من 12 MB")
    if not content:
        raise HTTPException(422, "ملف Excel فارغ")
    return content


@router.get("")
async def list_items(
    search: str = "",
    limit: int = 1000,
    profile: dict[str, Any] = Depends(current_profile),
) -> Any:
    require_permission(profile, "view_item_analysis")
    max_rows = min(max(limit, 1), 30000)
    params: dict[str, str] = {
        "select": "id,item_code,item_name,package_form,units_per_box,created_at,updated_at",
        "order": "item_name.asc",
    }
    q = search.strip()
    if q:
        safe_q = q
        for ch in "%*(),":
            safe_q = safe_q.replace(ch, " ")
        safe_q = " ".join(safe_q.split())[:120]
        if safe_q:
            params["or"] = f"(item_code.ilike.*{safe_q}*,item_name.ilike.*{safe_q}*)"

    result: list[dict[str, Any]] = []
    page_size = 1000
    for offset in range(0, max_rows, page_size):
        last = min(offset + page_size - 1, max_rows - 1)
        rows = await sb(
            "GET", "/rest/v1/item_catalog", service=True, params=params,
            headers={"Range": f"{offset}-{last}"},
        )
        result.extend(rows or [])
        if len(rows or []) < (last - offset + 1):
            break
    return result


@router.post("")
async def create_item(data: ItemInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_item_catalog")
    code = data.item_code.strip()
    existing = await sb(
        "GET", "/rest/v1/item_catalog", service=True,
        params={"select": "id", "item_code": f"eq.{code}", "limit": "1"},
    )
    if existing:
        raise HTTPException(409, "يوجد صنف بنفس الكود")
    rows = await sb(
        "POST", "/rest/v1/item_catalog", service=True,
        headers={"Prefer": "return=representation"},
        json={
            "item_code": code,
            "item_name": data.item_name.strip(),
            "package_form": (data.package_form or "").strip() or None,
            "units_per_box": data.units_per_box,
        },
    )
    return rows[0]


@router.put("/{item_id}")
async def update_item(item_id: str, data: ItemInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_item_catalog")
    code = data.item_code.strip()
    existing = await sb(
        "GET", "/rest/v1/item_catalog", service=True,
        params={"select": "id", "item_code": f"eq.{code}", "id": f"neq.{item_id}", "limit": "1"},
    )
    if existing:
        raise HTTPException(409, "يوجد صنف آخر بنفس الكود")
    rows = await sb(
        "PATCH", "/rest/v1/item_catalog", service=True,
        headers={"Prefer": "return=representation"},
        params={"id": f"eq.{item_id}"},
        json={
            "item_code": code,
            "item_name": data.item_name.strip(),
            "package_form": (data.package_form or "").strip() or None,
            "units_per_box": data.units_per_box,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    if not rows:
        raise HTTPException(404, "الصنف غير موجود")
    return rows[0]


@router.delete("/{item_id}")
async def delete_item(item_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_item_catalog")
    await sb("DELETE", "/rest/v1/item_catalog", service=True, params={"id": f"eq.{item_id}"})
    return {"ok": True}


@router.post("/import/preview")
async def preview_item_excel(
    file: UploadFile = File(...),
    profile: dict[str, Any] = Depends(current_profile),
) -> Any:
    require_permission(profile, "manage_item_catalog")
    content = await _read_excel_bytes(file)
    try:
        wb = load_workbook(BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise HTTPException(422, "تعذر قراءة ملف Excel") from exc

    sheets = []
    for ws in wb.worksheets[:10]:
        rows: list[list[str]] = []
        for row in ws.iter_rows(min_row=1, max_row=MAX_PREVIEW_ROWS, values_only=True):
            values = [_clean_text(v) for v in row[:MAX_PREVIEW_COLS]]
            while values and values[-1] == "":
                values.pop()
            rows.append(values)
        sheets.append({"name": ws.title, "rows": rows})
    wb.close()
    return {"filename": file.filename, "sheets": sheets}


@router.post("/import")
async def import_item_excel(
    file: UploadFile = File(...),
    sheet_name: str = Form(...),
    header_row: int = Form(...),
    code_column: int = Form(...),
    name_column: int = Form(...),
    units_column: int = Form(...),
    package_column: int | None = Form(None),
    profile: dict[str, Any] = Depends(current_profile),
) -> Any:
    require_permission(profile, "manage_item_catalog")
    if header_row < 1 or min(code_column, name_column, units_column) < 1:
        raise HTTPException(422, "تحديد الأعمدة غير صالح")

    content = await _read_excel_bytes(file)
    try:
        wb = load_workbook(BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        raise HTTPException(422, "تعذر قراءة ملف Excel") from exc
    if sheet_name not in wb.sheetnames:
        wb.close()
        raise HTTPException(422, "ورقة Excel المحددة غير موجودة")

    ws = wb[sheet_name]
    items_by_code: dict[str, dict[str, Any]] = {}
    skipped = 0
    invalid_examples: list[str] = []
    max_col = max(code_column, name_column, units_column, package_column or 0)

    for row_number, row in enumerate(ws.iter_rows(min_row=header_row + 1, values_only=True), start=header_row + 1):
        values = list(row)
        if not any(v not in (None, "") for v in values):
            continue
        if len(values) < max_col:
            values.extend([None] * (max_col - len(values)))
        code = _clean_text(values[code_column - 1])
        name = _clean_text(values[name_column - 1])
        units = _parse_units(values[units_column - 1])
        package = _clean_text(values[package_column - 1]) if package_column else ""
        if not code or not name or units is None:
            skipped += 1
            if len(invalid_examples) < 8:
                invalid_examples.append(f"صف {row_number}")
            continue
        items_by_code[code] = {
            "item_code": code[:160],
            "item_name": name[:240],
            "package_form": package[:120] or None,
            "units_per_box": units,
        }
    wb.close()

    now = datetime.now(timezone.utc).isoformat()
    for item in items_by_code.values():
        item["updated_at"] = now
    rows = list(items_by_code.values())
    if not rows:
        raise HTTPException(422, "لم يتم العثور على أصناف صالحة للاستيراد حسب الأعمدة المحددة")

    imported = 0
    for start in range(0, len(rows), 400):
        batch = rows[start:start + 400]
        await sb(
            "POST", "/rest/v1/item_catalog?on_conflict=item_code", service=True,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            json=batch,
        )
        imported += len(batch)

    return {
        "ok": True,
        "imported": imported,
        "skipped": skipped,
        "invalid_examples": invalid_examples,
        "message": "تم تحديث دليل الأصناف؛ الأكواد الموجودة تم تحديثها والجديدة تمت إضافتها",
    }
