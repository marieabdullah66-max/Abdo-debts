from fastapi import APIRouter, Depends
from ..core import *
from .notifications import create_notification_event

router = APIRouter(prefix="/api/payments", tags=["payments"])

async def _payment(payment_id: str) -> dict[str, Any]:
    rows = await sb("GET", "/rest/v1/payments", service=True, params={
        "select": "id,supplier_id,branch_id,amount,payment_date,method,bank_name,notes,created_at,suppliers(name),branches(name),payment_allocations(id,invoice_id,amount,invoices(invoice_number))",
        "id": f"eq.{payment_id}", "limit": "1"
    })
    if not rows:
        raise HTTPException(404, "السداد غير موجود")
    return rows[0]

async def _validate_payment_input(data: PaymentInput, profile: dict[str, Any], *, payment_id: str | None = None) -> None:
    require_branch_access(profile, data.branch_id)
    supplier = await sb("GET", "/rest/v1/suppliers", service=True, params={"select": "id", "id": f"eq.{data.supplier_id}", "active": "eq.true", "limit": "1"})
    if not supplier:
        raise HTTPException(422, "المورد غير موجود")
    ids = [x.invoice_id for x in data.allocations]
    rows = await sb("GET", "/rest/v1/invoice_balances", service=True, params={
        "select": "id,supplier_id,branch_id,balance", "id": f"in.({','.join(ids)})", "limit": "500"
    })
    found = {x["id"]: x for x in rows or []}
    if len(found) != len(ids):
        raise HTTPException(422, "إحدى الفواتير غير موجودة")
    old_alloc: dict[str, float] = {}
    if payment_id:
        old_rows = await sb("GET", "/rest/v1/payment_allocations", service=True, params={"select": "invoice_id,amount", "payment_id": f"eq.{payment_id}", "limit": "500"})
        old_alloc = {x["invoice_id"]: float(x.get("amount") or 0) for x in old_rows or []}
    for allocation in data.allocations:
        inv = found[allocation.invoice_id]
        if inv["supplier_id"] != data.supplier_id or inv["branch_id"] != data.branch_id:
            raise HTTPException(422, "كل الفواتير المختارة يجب أن تكون لنفس المورد ونفس الفرع")
        available = float(inv.get("balance") or 0) + old_alloc.get(allocation.invoice_id, 0.0)
        if round(allocation.amount, 2) > round(available, 2):
            raise HTTPException(422, f"قيمة التوزيع أكبر من المتبقي في الفاتورة ({available:.2f})")

@router.get("")
async def list_payments(supplier_id: str | None = None, branch_id: str | None = None, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "view_payments")
    params: dict[str, str] = {
        "select": "id,supplier_id,branch_id,amount,payment_date,method,bank_name,notes,created_at,suppliers(name),branches(name),payment_allocations(invoice_id,amount,invoices(invoice_number))",
        "order": "payment_date.desc,created_at.desc", "limit": "5000"
    }
    params = apply_branch_filter(params, profile)
    if supplier_id:
        params["supplier_id"] = f"eq.{supplier_id}"
    if branch_id:
        require_branch_access(profile, branch_id)
        params["branch_id"] = f"eq.{branch_id}"
    return await sb("GET", "/rest/v1/payments", service=True, params=params)

@router.get("/{payment_id}")
async def get_payment(payment_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "view_payments")
    payment = await _payment(payment_id)
    require_branch_access(profile, payment["branch_id"])
    return payment

@router.post("")
async def create_payment(data: PaymentInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "create_payments")
    await _validate_payment_input(data, profile)
    rows = await sb("POST", "/rest/v1/rpc/create_payment_with_allocations", service=True, json={
        "p_supplier_id": data.supplier_id,
        "p_branch_id": data.branch_id,
        "p_amount": round(data.amount, 2),
        "p_payment_date": data.payment_date.isoformat(),
        "p_method": data.method,
        "p_bank_name": (data.bank_name or "").strip() or None,
        "p_notes": (data.notes or "").strip() or None,
        "p_created_by": profile["id"],
        "p_allocations": [{"invoice_id": x.invoice_id, "amount": round(x.amount, 2)} for x in data.allocations],
    })
    await create_notification_event(
        event_type="payment_created", branch_id=data.branch_id, supplier_id=data.supplier_id,
        entity_id=str(rows), amount=data.amount, profile=profile,
    )
    return {"id": rows}

@router.put("/{payment_id}")
async def update_payment(payment_id: str, data: PaymentInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "edit_payments")
    current = await _payment(payment_id)
    require_branch_access(profile, current["branch_id"])
    await _validate_payment_input(data, profile, payment_id=payment_id)
    await sb("POST", "/rest/v1/rpc/update_payment_with_allocations", service=True, json={
        "p_payment_id": payment_id,
        "p_supplier_id": data.supplier_id,
        "p_branch_id": data.branch_id,
        "p_amount": round(data.amount, 2),
        "p_payment_date": data.payment_date.isoformat(),
        "p_method": data.method,
        "p_bank_name": (data.bank_name or "").strip() or None,
        "p_notes": (data.notes or "").strip() or None,
        "p_allocations": [{"invoice_id": x.invoice_id, "amount": round(x.amount, 2)} for x in data.allocations],
    })
    return {"ok": True}

@router.delete("/{payment_id}")
async def delete_payment(payment_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "delete_payments")
    current = await _payment(payment_id)
    require_branch_access(profile, current["branch_id"])
    await sb("DELETE", "/rest/v1/payments", service=True, params={"id": f"eq.{payment_id}"})
    return {"ok": True}
