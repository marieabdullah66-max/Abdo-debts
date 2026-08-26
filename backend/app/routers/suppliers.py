from fastapi import APIRouter, Depends
from ..core import *

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])


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


@router.get("")
async def list_suppliers(q: str | None = None, branch_id: str | None = None, include_balance: bool = False, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "view_suppliers")
    params = {"select": "id,name,phone,notes,active,created_at", "active": "eq.true", "order": "name.asc", "limit": "5000"}
    if q:
        safe = q.strip().replace("%", "")[:80]
        if safe:
            params["name"] = f"ilike.*{safe}*"
    suppliers = await sb("GET", "/rest/v1/suppliers", service=True, params=params)
    categories_by_supplier = await _category_map()

    if not include_balance and not branch_id:
        return [{**supplier, "categories": categories_by_supplier.get(supplier.get("id"), [])} for supplier in (suppliers or [])]

    inv_params: dict[str, str] = {"select": "supplier_id,balance", "limit": "10000"}
    inv_params = apply_branch_filter(inv_params, profile)
    if branch_id:
        require_branch_access(profile, branch_id)
        inv_params["branch_id"] = f"eq.{branch_id}"
    invoices = await sb("GET", "/rest/v1/invoice_balances", service=True, params=inv_params)

    balances: dict[str, float] = {}
    suppliers_in_branch: set[str] = set()
    for inv in invoices or []:
        sid = inv.get("supplier_id")
        if not sid:
            continue
        suppliers_in_branch.add(sid)
        balances[sid] = balances.get(sid, 0.0) + float(inv.get("balance") or 0)

    rows = []
    for supplier in suppliers or []:
        if branch_id and supplier.get("id") not in suppliers_in_branch:
            continue
        rows.append({
            **supplier,
            "categories": categories_by_supplier.get(supplier.get("id"), []),
            "balance": round(balances.get(supplier.get("id"), 0.0), 2),
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
