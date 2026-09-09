from datetime import date
import csv
import io
import re
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, UploadFile
from ..core import *

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])


def _clean_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\ufeff", "").strip().split())


def _parse_money(value: Any) -> float:
    raw = _clean_text(value).replace(",", "")
    if not raw:
        return 0.0
    raw = re.sub(r"[^0-9.\-]", "", raw)
    if raw in {"", ".", "-"}:
        return 0.0
    try:
        return float(abs(Decimal(raw)))
    except (InvalidOperation, ValueError):
        return 0.0


def _parse_date(value: Any) -> date | None:
    raw = _clean_text(value)
    if not raw or raw in {".", "-", "غيرمحدد"}:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            from datetime import datetime
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    return None


def _looks_like_date(value: str) -> bool:
    return _parse_date(value) is not None


def _parse_supplier_csv_rows(text: str) -> list[dict[str, Any]]:
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample)
    except csv.Error:
        dialect = csv.excel
    rows: list[dict[str, Any]] = []
    for idx, row in enumerate(csv.reader(io.StringIO(text), dialect), start=1):
        if not row or len(row) < 8:
            continue
        cells = [_clean_text(x) for x in row]

        # The common exported customer/supplier report repeats header labels in
        # each row. In that file the useful data is at fixed positions.
        name = cells[13] if len(cells) > 13 else ""
        reference_no = cells[14] if len(cells) > 14 else ""
        balance = _parse_money(cells[12] if len(cells) > 12 else "")
        last_payment_date = _parse_date(cells[16] if len(cells) > 16 else "")
        last_invoice_date = _parse_date(cells[17] if len(cells) > 17 else "")

        # Fallback for slightly different exports: try the cells after the
        # repeated labels and choose a human name, not dates/numbers/placeholders.
        if not name or name in {".", "غيرمحدد"} or _looks_like_date(name) or re.fullmatch(r"[0-9.,\-]+", name or ""):
            candidates = cells[8:]
            for c in candidates:
                if not c or c in {".", "غيرمحدد", "الاجمالي :"}:
                    continue
                if _looks_like_date(c) or re.fullmatch(r"[0-9.,\-]+", c):
                    continue
                name = c
                break
        if not name or name in {".", "غيرمحدد"}:
            continue
        rows.append({
            "source_row": idx,
            "name": name[:160],
            "reference_no": reference_no[:100] or None,
            "balance": round(balance, 2),
            "last_payment_date": last_payment_date.isoformat() if last_payment_date else None,
            "last_invoice_date": last_invoice_date.isoformat() if last_invoice_date else None,
            "include": True,
        })
    return rows


async def _unique_import_invoice_number(supplier_id: str, base: str) -> str:
    base = _clean_text(base)[:90] or "IMPORT"
    existing = await sb("GET", "/rest/v1/invoices", service=True, params={"select": "invoice_number", "supplier_id": f"eq.{supplier_id}", "invoice_number": f"ilike.{base}%", "limit": "10000"})
    used = {_clean_text(x.get("invoice_number")) for x in existing or []}
    if base not in used:
        return base
    for i in range(2, 10000):
        candidate = f"{base}-{i}"
        if candidate not in used:
            return candidate
    return f"{base}-{int(time.time())}"

async def _category_map() -> dict[str, list[dict[str, Any]]]:
    links = await sb(
        "GET", "/rest/v1/supplier_category_links", service=True,
        params={
            "select": "supplier_id,category_id,supplier_categories(id,name)",
            "limit": "20000",
        },
    )
    result: dict[str, list[dict[str, Any]]] = {}
    for link in links or []:
        supplier_id = link.get("supplier_id")
        category = link.get("supplier_categories") or {}
        if not supplier_id or not category.get("id"):
            continue
        result.setdefault(supplier_id, []).append({"id": category.get("id"), "name": category.get("name") or ""})
    for rows in result.values():
        rows.sort(key=lambda x: (x.get("name") or "").lower())
    return result


async def _validate_category_ids(category_ids: list[str]) -> list[str]:
    ids = list(dict.fromkeys(category_ids or []))
    if not ids:
        return []
    rows = await sb(
        "GET", "/rest/v1/supplier_categories", service=True,
        params={"select": "id", "id": f"in.({','.join(ids)})", "limit": str(max(100, len(ids)))},
    )
    found = {row.get("id") for row in rows or []}
    if found != set(ids):
        raise HTTPException(422, "يوجد تصنيف مورد غير صالح")
    return ids


async def _replace_supplier_categories(supplier_id: str, category_ids: list[str]) -> None:
    await sb("DELETE", "/rest/v1/supplier_category_links", service=True, params={"supplier_id": f"eq.{supplier_id}"})
    if category_ids:
        await sb(
            "POST", "/rest/v1/supplier_category_links", service=True,
            json=[{"supplier_id": supplier_id, "category_id": category_id} for category_id in category_ids],
        )


@router.post("/import/preview")
async def preview_supplier_import(file: UploadFile = File(...), profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_suppliers")
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "حجم الملف كبير جدًا")
    name = (file.filename or "").lower()
    if name.endswith(".csv") or file.content_type in {"text/csv", "application/csv", "application/vnd.ms-excel"}:
        text = None
        for enc in ("utf-8-sig", "utf-8", "cp1256", "windows-1256", "latin-1"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                pass
        if text is None:
            raise HTTPException(422, "تعذر قراءة ملف CSV")
        rows = _parse_supplier_csv_rows(text)
    else:
        raise HTTPException(422, "الاستيراد يدعم ملف CSV حاليًا")
    return {"rows": rows[:5000], "total_rows": len(rows), "filename": file.filename}


@router.post("/import")
async def import_suppliers(data: SupplierImportInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_suppliers")
    require_permission(profile, "create_invoices")
    require_branch_access(profile, data.branch_id)
    branch = await sb("GET", "/rest/v1/branches", service=True, params={"select": "id,name", "id": f"eq.{data.branch_id}", "active": "eq.true", "limit": "1"})
    if not branch:
        raise HTTPException(422, "الفرع غير موجود أو موقوف")

    existing = await sb("GET", "/rest/v1/suppliers", service=True, params={"select": "id,name", "active": "eq.true", "limit": "10000"})
    by_name = {_clean_text(s.get("name")).casefold(): s for s in existing or []}
    created = 0
    reused = 0
    invoices_created = 0
    skipped = 0
    imported_rows = []

    for idx, row in enumerate(data.rows, start=1):
        if not row.include:
            skipped += 1
            continue
        clean_name = _clean_text(row.name)
        if len(clean_name) < 2:
            skipped += 1
            continue
        key = clean_name.casefold()
        supplier = by_name.get(key)
        if not supplier:
            inserted = await sb("POST", "/rest/v1/suppliers", service=True, headers={"Prefer": "return=representation"}, json={
                "name": clean_name,
                "phone": None,
                "notes": f"استيراد خارجي - ر.م: {row.reference_no}" if row.reference_no else "استيراد خارجي",
                "created_by": profile["id"],
                "active": True,
            })
            supplier = inserted[0]
            by_name[key] = supplier
            created += 1
        else:
            reused += 1

        if round(float(row.balance or 0), 2) > 0:
            invoice_date = row.last_invoice_date or date.today()
            ref = _clean_text(row.reference_no) or str(idx)
            invoice_number = await _unique_import_invoice_number(supplier["id"], f"IMPORT-{ref}-{invoice_date.isoformat()}")
            await sb("POST", "/rest/v1/invoices", service=True, headers={"Prefer": "return=representation"}, json={
                "supplier_id": supplier["id"],
                "branch_id": data.branch_id,
                "invoice_number": invoice_number,
                "amount": round(float(row.balance or 0), 2),
                "invoice_date": invoice_date.isoformat(),
                "due_date": None,
                "notes": f"رصيد مستورد من ملف خارجي{(' - آخر سداد: ' + row.last_payment_date.isoformat()) if row.last_payment_date else ''}",
                "created_by": profile["id"],
            })
            invoices_created += 1
        imported_rows.append({"name": clean_name, "supplier_id": supplier["id"], "balance": round(float(row.balance or 0), 2)})

    return {
        "ok": True,
        "created_suppliers": created,
        "existing_suppliers": reused,
        "invoices_created": invoices_created,
        "skipped": skipped,
        "rows": imported_rows[:50],
    }


@router.get("")
async def list_suppliers(q: str | None = None, branch_id: str | None = None, include_balance: bool = False, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    if not (effective_permissions(profile).get("view_suppliers") or effective_permissions(profile).get("view_payment_plans")):
        raise HTTPException(403, "ليس لديك صلاحية عرض الموردين")
    params = {"select": "id,name,phone,notes,active,created_at", "active": "eq.true", "order": "name.asc", "limit": "5000"}
    if q:
        safe = q.strip().replace("%", "")[:80]
        if safe:
            params["name"] = f"ilike.*{safe}*"
    suppliers = await sb("GET", "/rest/v1/suppliers", service=True, params=params)
    categories_by_supplier = await _category_map()

    if not include_balance and not branch_id:
        return [{**supplier, "categories": categories_by_supplier.get(supplier.get("id"), [])} for supplier in (suppliers or [])]

    inv_params: dict[str, str] = {"select": "supplier_id,balance,invoice_date", "limit": "10000"}
    inv_params = apply_branch_filter(inv_params, profile)
    if branch_id:
        require_branch_access(profile, branch_id)
        inv_params["branch_id"] = f"eq.{branch_id}"
    invoices = await sb("GET", "/rest/v1/invoice_balances", service=True, params=inv_params)

    balances: dict[str, float] = {}
    oldest_open_invoice: dict[str, date] = {}
    suppliers_in_branch: set[str] = set()
    for inv in invoices or []:
        sid = inv.get("supplier_id")
        if not sid:
            continue
        suppliers_in_branch.add(sid)
        balance = float(inv.get("balance") or 0)
        balances[sid] = balances.get(sid, 0.0) + balance
        if balance <= 0 or not inv.get("invoice_date"):
            continue
        try:
            invoice_date = date.fromisoformat(str(inv.get("invoice_date")))
        except ValueError:
            continue
        previous = oldest_open_invoice.get(sid)
        if previous is None or invoice_date < previous:
            oldest_open_invoice[sid] = invoice_date

    today = date.today()
    rows = []
    for supplier in suppliers or []:
        if branch_id and supplier.get("id") not in suppliers_in_branch:
            continue
        rows.append({
            **supplier,
            "categories": categories_by_supplier.get(supplier.get("id"), []),
            "balance": round(balances.get(supplier.get("id"), 0.0), 2),
            "aging_days": (
                max(0, (today - oldest_open_invoice[supplier.get("id")]).days)
                if supplier.get("id") in oldest_open_invoice else None
            ),
            "oldest_open_invoice_date": (
                oldest_open_invoice[supplier.get("id")].isoformat()
                if supplier.get("id") in oldest_open_invoice else None
            ),
        })
    return rows


@router.post("")
async def create_supplier(data: SupplierInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_suppliers")
    category_ids = await _validate_category_ids(data.category_ids)
    rows = await sb("POST", "/rest/v1/suppliers", service=True, headers={"Prefer": "return=representation"}, json={
        "name": data.name.strip(), "phone": (data.phone or "").strip() or None, "notes": (data.notes or "").strip() or None,
        "created_by": profile["id"], "active": True,
    })
    supplier = rows[0]
    try:
        await _replace_supplier_categories(supplier["id"], category_ids)
    except Exception:
        await sb("DELETE", "/rest/v1/suppliers", service=True, params={"id": f"eq.{supplier['id']}"})
        raise
    supplier["categories"] = [x for x in (await _category_map()).get(supplier["id"], [])]
    return supplier


@router.put("/{supplier_id}")
async def update_supplier(supplier_id: str, data: SupplierInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_suppliers")
    category_ids = await _validate_category_ids(data.category_ids)
    rows = await sb("PATCH", "/rest/v1/suppliers", service=True, headers={"Prefer": "return=representation"}, params={"id": f"eq.{supplier_id}"}, json={
        "name": data.name.strip(), "phone": (data.phone or "").strip() or None, "notes": (data.notes or "").strip() or None,
    })
    if not rows:
        raise HTTPException(404, "المورد غير موجود")
    await _replace_supplier_categories(supplier_id, category_ids)
    rows[0]["categories"] = (await _category_map()).get(supplier_id, [])
    return rows[0]


@router.delete("/{supplier_id}")
async def delete_supplier(supplier_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_suppliers")
    linked = await sb("GET", "/rest/v1/invoices", service=True, params={"select": "id", "supplier_id": f"eq.{supplier_id}", "limit": "1"})
    if linked:
        raise HTTPException(409, "لا يمكن حذف المورد لوجود فواتير مرتبطة به")
    await sb("DELETE", "/rest/v1/suppliers", service=True, params={"id": f"eq.{supplier_id}"})
    return {"ok": True}


@router.get("/{supplier_id}/summary")
async def supplier_summary(supplier_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "view_suppliers")
    supplier = await sb("GET", "/rest/v1/suppliers", service=True, params={"select": "id,name,phone,notes", "id": f"eq.{supplier_id}", "limit": "1"})
    if not supplier:
        raise HTTPException(404, "المورد غير موجود")
    supplier[0]["categories"] = (await _category_map()).get(supplier_id, [])
    params = apply_branch_filter({
        "select": "id,invoice_number,amount,paid_amount,balance,status,invoice_date,due_date,notes,pdf_path,branch_id,branch_name",
        "supplier_id": f"eq.{supplier_id}", "order": "invoice_date.desc", "limit": "5000"
    }, profile)
    invoices = await sb("GET", "/rest/v1/invoice_balances", service=True, params=params)
    totals = {
        "invoiced": round(sum(float(x.get("amount") or 0) for x in invoices or []), 2),
        "paid": round(sum(float(x.get("paid_amount") or 0) for x in invoices or []), 2),
        "balance": round(sum(float(x.get("balance") or 0) for x in invoices or []), 2),
    }
    by_branch: dict[str, dict[str, Any]] = {}
    for inv in invoices or []:
        bid = inv.get("branch_id")
        row = by_branch.setdefault(bid, {"branch_id": bid, "branch_name": inv.get("branch_name", ""), "invoiced": 0.0, "paid": 0.0, "balance": 0.0})
        row["invoiced"] += float(inv.get("amount") or 0)
        row["paid"] += float(inv.get("paid_amount") or 0)
        row["balance"] += float(inv.get("balance") or 0)
    return {"supplier": supplier[0], "totals": totals, "by_branch": list(by_branch.values()), "invoices": [{**x, "branches": {"name": x.get("branch_name")}} for x in (invoices or [])]}
