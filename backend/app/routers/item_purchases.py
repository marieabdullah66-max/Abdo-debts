from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..core import apply_branch_filter, current_profile, require_branch_access, require_permission, sb
from .item_movements import (
    BOX_UNIT, LOOSE_UNIT, _catalog_and_aliases, _normalize_code, _normalize_name,
    _number, _read_report, _text, _value_date,
)

router = APIRouter(prefix="/api/item-purchases", tags=["item-purchases"])


def _purchase_line_date(value: Any) -> date | None:
    parsed = _value_date(value)
    if parsed:
        return parsed
    text = _text(value).split()[0] if _text(value) else ""
    for fmt in ("%m/%d/%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _row_value(row: list[Any], header: str, offset: int = 9) -> str:
    try:
        idx = next(i for i, value in enumerate(row) if _text(value) == header)
    except StopIteration:
        return ""
    pos = idx + offset
    return _text(row[pos]) if pos < len(row) else ""


def _purchase_report_period(rows: list[list[Any]]) -> tuple[date, date, str | None]:
    source_name = None
    if rows and rows[0]:
        source_name = _text(rows[0][2]) or _text(rows[0][0]) or None
    for row in rows[:12]:
        start = None
        end = None
        for idx, value in enumerate(row):
            label = _text(value)
            if label == "الفترة من" and idx >= 1:
                start = _value_date(row[idx - 1])
            if label in {"الفترة إلي", "الفترة إلى"} and idx >= 1:
                end = _value_date(row[idx - 1])
        if start and end and end >= start:
            return start, end, source_name
    dates: list[date] = []
    for row in rows:
        if len(row) > 30:
            parsed = _purchase_line_date(row[30])
            if parsed:
                dates.append(parsed)
    if dates:
        return min(dates), max(dates), source_name
    raise HTTPException(422, "لم نستطع قراءة فترة تقرير المشتريات من الملف")


def _purchase_unit(row: list[Any]) -> str:
    for idx in (28, 29, 11):
        if idx < len(row):
            value = _text(row[idx])
            if value in {BOX_UNIT, LOOSE_UNIT}:
                return value
    return BOX_UNIT


def _parse_purchase_lines(rows: list[list[Any]]) -> tuple[list[dict[str, Any]], int]:
    lines: list[dict[str, Any]] = []
    skipped = 0
    current_date: date | None = None
    current_invoice = ""
    current_supplier = ""
    for row in rows:
        row_date = _purchase_line_date(row[30]) if len(row) > 30 else None
        if row_date:
            current_date = row_date
        if len(row) > 31 and _text(row[31]) and _text(row[31]) != "0":
            current_invoice = _text(row[31])
        if len(row) > 26 and _text(row[26]) and _text(row[26]) != "0":
            current_supplier = _text(row[26])

        item_name = _row_value(row, "اسم الصنف")
        quantity = _number(_row_value(row, "الكمية"))
        price = _number(_row_value(row, "السعر")) or 0.0
        if not item_name or quantity is None or quantity == 0:
            continue
        if not current_date:
            skipped += 1
            continue
        unit = _purchase_unit(row)
        movement_type = _row_value(row, "نوع ورقم الفاتورة") or _text(row[24]) if len(row) > 24 else ""
        sign = -1.0 if ("مردود" in movement_type or "مرتجع" in movement_type) else 1.0
        qty = float(quantity) * sign
        lines.append({
            "purchase_date": current_date,
            "supplier_name": current_supplier,
            "invoice_number": current_invoice,
            "report_name": item_name,
            "report_name_norm": _normalize_name(item_name),
            "report_code": "",
            "unit": unit,
            "quantity": qty,
            "price": float(price),
            "purchase_value": round(float(price) * qty, 6),
        })
    if not lines:
        raise HTTPException(422, "لم نجد أصناف مشتريات صالحة داخل التقرير")
    return lines, skipped


async def _resolve_purchase_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    catalog, aliases = await _catalog_and_aliases()
    by_id = {str(x["id"]): x for x in catalog}
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in catalog:
        name = _normalize_name(str(item.get("item_name") or ""))
        code = _normalize_code(item.get("item_code"))
        if name:
            by_name[name].append(item)
        if code:
            by_code[code].append(item)

    resolved: list[dict[str, Any]] = []
    for row in lines:
        item = None
        matched_by = "unmatched"
        code = _normalize_code(row.get("report_code"))
        name = str(row.get("report_name_norm") or "")
        code_matches = by_code.get(code) or [] if code else []
        if len(code_matches) == 1:
            item = code_matches[0]
            matched_by = "exact"
        else:
            exact = by_name.get(name) or []
            if len(exact) == 1:
                item = exact[0]
                matched_by = "exact"
            else:
                alias_item_id = aliases.get(name)
                if alias_item_id and alias_item_id in by_id:
                    item = by_id[alias_item_id]
                    matched_by = "alias"
        units = int(item.get("units_per_box") or 0) if item else None
        qty = float(row["quantity"])
        boxes = qty if row["unit"] == BOX_UNIT else 0.0
        loose = qty if row["unit"] == LOOSE_UNIT else 0.0
        equivalent = None
        if units and units > 0:
            equivalent = round(boxes + loose / units, 6)
        elif loose == 0:
            equivalent = round(boxes, 6)
        resolved.append({
            **row,
            "item_id": str(item["id"]) if item else None,
            "item_code": str(item.get("item_code") or "") if item else None,
            "catalog_name": str(item.get("item_name") or "") if item else None,
            "units_per_box": units,
            "boxes_purchased": round(boxes, 6),
            "loose_purchased": round(loose, 6),
            "equivalent_boxes": equivalent,
            "matched_by": matched_by,
        })
    return resolved


async def _parse_purchase_file(file: UploadFile) -> dict[str, Any]:
    _content, rows = await _read_report(file)
    start, end, source_name = _purchase_report_period(rows)
    lines, skipped = _parse_purchase_lines(rows)
    resolved = await _resolve_purchase_lines(lines)
    unique_keys = {x["item_id"] or x["report_name_norm"] for x in resolved}
    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "source_name": source_name,
        "row_count": len(resolved),
        "unique_item_count": len(unique_keys),
        "unresolved_count": sum(1 for x in resolved if not x.get("item_id")),
        "blocking_count": sum(1 for x in resolved if not x.get("item_id") and float(x.get("loose_purchased") or 0) != 0),
        "skipped_rows": skipped,
        "total_purchase_value": round(sum(float(x.get("purchase_value") or 0) for x in resolved), 4),
        "total_equivalent_boxes": round(sum(float(x.get("equivalent_boxes") or 0) for x in resolved), 4),
        "rows": resolved,
    }


@router.post("/preview")
async def preview_purchase_archive(
    branch_id: str = Form(...),
    file: UploadFile = File(...),
    profile: dict[str, Any] = Depends(current_profile),
) -> Any:
    require_permission(profile, "view_item_analysis")
    require_branch_access(profile, branch_id)
    parsed = await _parse_purchase_file(file)
    sample_unmatched = [
        {"report_name": x["report_name"], "unit": x["unit"], "quantity": x["quantity"]}
        for x in parsed["rows"] if not x.get("item_id")
    ][:20]
    return {k: v for k, v in parsed.items() if k != "rows"} | {"unmatched_sample": sample_unmatched}


@router.post("/import")
async def import_purchase_archive(
    branch_id: str = Form(...),
    file: UploadFile = File(...),
    profile: dict[str, Any] = Depends(current_profile),
) -> Any:
    require_permission(profile, "manage_item_catalog")
    require_branch_access(profile, branch_id)
    parsed = await _parse_purchase_file(file)

    existing = await sb(
        "GET", "/rest/v1/item_purchase_imports", service=True,
        params={"select": "id", "branch_id": f"eq.{branch_id}", "limit": "100"},
    )
    for old in existing or []:
        await sb("DELETE", "/rest/v1/item_purchase_imports", service=True, params={"id": f"eq.{old['id']}"})

    created = await sb(
        "POST", "/rest/v1/item_purchase_imports", service=True,
        headers={"Prefer": "return=representation"},
        json={
            "branch_id": branch_id,
            "source_name": parsed["source_name"],
            "source_filename": (file.filename or "")[:240],
            "period_start": parsed["period_start"],
            "period_end": parsed["period_end"],
            "row_count": parsed["row_count"],
            "unique_item_count": parsed["unique_item_count"],
            "unresolved_count": parsed["unresolved_count"],
            "total_purchase_value": parsed["total_purchase_value"],
            "total_equivalent_boxes": parsed["total_equivalent_boxes"],
            "created_by": profile["id"],
        },
    )
    archive = created[0]
    payload = []
    for row in parsed["rows"]:
        payload.append({
            "import_id": archive["id"],
            "branch_id": branch_id,
            "purchase_date": row["purchase_date"].isoformat(),
            "supplier_name": str(row.get("supplier_name") or "")[:240] or None,
            "invoice_number": str(row.get("invoice_number") or "")[:120] or None,
            "report_name": row["report_name"][:300],
            "report_name_norm": row["report_name_norm"][:300],
            "item_id": row["item_id"],
            "unit": row["unit"],
            "quantity": row["quantity"],
            "boxes_purchased": row["boxes_purchased"],
            "loose_purchased": row["loose_purchased"],
            "units_per_box": row["units_per_box"],
            "equivalent_boxes": row["equivalent_boxes"],
            "purchase_value": row["purchase_value"],
            "matched_by": row["matched_by"],
        })
    for start in range(0, len(payload), 400):
        await sb("POST", "/rest/v1/item_purchase_rows", service=True, headers={"Prefer": "return=minimal"}, json=payload[start:start + 400])
    return {"ok": True, "archive_id": archive["id"], **{k: v for k, v in parsed.items() if k != "rows"}}


@router.get("/archive")
async def purchase_archive(branch_id: str | None = None, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "view_item_analysis")
    params: dict[str, str] = {
        "select": "id,branch_id,source_name,source_filename,period_start,period_end,row_count,unique_item_count,unresolved_count,total_purchase_value,total_equivalent_boxes,created_at,branches(name)",
        "order": "created_at.desc", "limit": "20",
    }
    params = apply_branch_filter(params, profile)
    if branch_id:
        require_branch_access(profile, branch_id)
        params["branch_id"] = f"eq.{branch_id}"
    return await sb("GET", "/rest/v1/item_purchase_imports", service=True, params=params)


@router.delete("/archive/{archive_id}")
async def delete_purchase_archive(archive_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_item_catalog")
    rows = await sb(
        "GET", "/rest/v1/item_purchase_imports", service=True,
        params={"select": "id,branch_id", "id": f"eq.{archive_id}", "limit": "1"},
    )
    if not rows:
        raise HTTPException(404, "أرشيف المشتريات غير موجود")
    require_branch_access(profile, str(rows[0]["branch_id"]))
    await sb("DELETE", "/rest/v1/item_purchase_imports", service=True, params={"id": f"eq.{archive_id}"})
    return {"ok": True}


@router.get("/summary")
async def purchase_summary(
    branch_id: str,
    start: str,
    end: str,
    profile: dict[str, Any] = Depends(current_profile),
) -> Any:
    require_permission(profile, "view_item_analysis")
    require_branch_access(profile, branch_id)
    try:
        start_date = datetime.strptime(start[:10], "%Y-%m-%d").date()
        end_date = datetime.strptime(end[:10], "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(422, "تاريخ المشتريات غير صحيح") from exc
    if end_date < start_date:
        raise HTTPException(422, "نهاية الفترة قبل بدايتها")

    archives = await sb(
        "GET", "/rest/v1/item_purchase_imports", service=True,
        params={"select": "id,period_start,period_end,row_count,unique_item_count,unresolved_count,total_equivalent_boxes", "branch_id": f"eq.{branch_id}", "order": "created_at.desc", "limit": "1"},
    )
    if not archives:
        return {"archive": None, "summary": {"row_count": 0, "unique_item_count": 0, "total_equivalent_boxes": 0, "total_purchase_value": 0}, "rows": []}
    archive = archives[0]
    # The Supabase wrapper takes a dict; build a clean request with both operators using and= to avoid duplicate dict keys.
    rows = []
    for offset in range(0, 50000, 1000):
        batch = await sb(
            "GET", "/rest/v1/item_purchase_rows", service=True,
            params={
                "select": "item_id,report_name,report_name_norm,purchase_date,boxes_purchased,loose_purchased,equivalent_boxes,purchase_value,matched_by,item_catalog(item_code,item_name)",
                "import_id": f"eq.{archive['id']}",
                "branch_id": f"eq.{branch_id}",
                "and": f"(purchase_date.gte.{start_date.isoformat()},purchase_date.lte.{end_date.isoformat()})",
            },
            headers={"Range": f"{offset}-{offset + 999}"},
        )
        rows.extend(batch or [])
        if len(batch or []) < 1000:
            break

    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        item_id = str(row.get("item_id") or "")
        norm = str(row.get("report_name_norm") or "")
        key = f"item:{item_id}" if item_id else f"name:{norm}"
        bucket = grouped.setdefault(key, {
            "item_id": item_id or None,
            "report_name": row.get("report_name"),
            "report_name_norm": norm,
            "item_catalog": row.get("item_catalog"),
            "boxes_purchased": 0.0,
            "loose_purchased": 0.0,
            "equivalent_boxes": 0.0,
            "purchase_value": 0.0,
            "line_count": 0,
            "matched_by": row.get("matched_by") or "unmatched",
        })
        bucket["boxes_purchased"] += float(row.get("boxes_purchased") or 0)
        bucket["loose_purchased"] += float(row.get("loose_purchased") or 0)
        bucket["equivalent_boxes"] += float(row.get("equivalent_boxes") or 0)
        bucket["purchase_value"] += float(row.get("purchase_value") or 0)
        bucket["line_count"] += 1
    result = []
    for bucket in grouped.values():
        for k in ("boxes_purchased", "loose_purchased", "equivalent_boxes", "purchase_value"):
            bucket[k] = round(float(bucket[k]), 6)
        result.append(bucket)
    result.sort(key=lambda x: float(x.get("equivalent_boxes") or 0), reverse=True)
    return {
        "archive": archive,
        "summary": {
            "row_count": len(rows),
            "unique_item_count": len(result),
            "total_equivalent_boxes": round(sum(float(x.get("equivalent_boxes") or 0) for x in result), 4),
            "total_purchase_value": round(sum(float(x.get("purchase_value") or 0) for x in result), 4),
        },
        "rows": result,
    }
