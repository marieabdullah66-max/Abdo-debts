from collections import defaultdict
from datetime import date
from fastapi import APIRouter, Depends
from ..core import *

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

@router.get("")
async def dashboard(branch_id: str | None = None, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "view_dashboard")
    inv_params: dict[str, str] = {
        "select": "id,supplier_id,branch_id,supplier_name,branch_name,amount,paid_amount,balance,status,due_date",
        "limit": "10000"
    }
    pay_params: dict[str, str] = {"select": "amount,method,payment_date,branch_id", "limit": "10000"}
    inv_params = apply_branch_filter(inv_params, profile)
    pay_params = apply_branch_filter(pay_params, profile)
    if branch_id:
        require_branch_access(profile, branch_id)
        inv_params["branch_id"] = f"eq.{branch_id}"
        pay_params["branch_id"] = f"eq.{branch_id}"
    invoices = await sb("GET", "/rest/v1/invoice_balances", service=True, params=inv_params)
    payments = await sb("GET", "/rest/v1/payments", service=True, params=pay_params)
    today = date.today().isoformat()
    totals = {
        "invoiced": round(sum(float(x.get("amount") or 0) for x in invoices or []), 2),
        "paid": round(sum(float(x.get("paid_amount") or 0) for x in invoices or []), 2),
        "balance": round(sum(float(x.get("balance") or 0) for x in invoices or []), 2),
        "overdue": round(sum(float(x.get("balance") or 0) for x in invoices or [] if x.get("due_date") and x["due_date"] < today and float(x.get("balance") or 0) > 0), 2),
    }
    counts = {status: len([x for x in invoices or [] if x.get("status") == status]) for status in ("unpaid", "partial", "paid")}
    supplier_balances: dict[str, dict[str, Any]] = defaultdict(lambda: {"name": "", "balance": 0.0})
    branch_balances: dict[str, dict[str, Any]] = defaultdict(lambda: {"name": "", "balance": 0.0})
    for inv in invoices or []:
        sid = inv.get("supplier_id")
        bid = inv.get("branch_id")
        supplier_balances[sid]["name"] = inv.get("supplier_name", "")
        supplier_balances[sid]["balance"] += float(inv.get("balance") or 0)
        branch_balances[bid]["name"] = inv.get("branch_name", "")
        branch_balances[bid]["balance"] += float(inv.get("balance") or 0)
    month = date.today().isoformat()[:7]
    month_payments = [x for x in payments or [] if str(x.get("payment_date", "")).startswith(month)]
    return {
        "totals": totals,
        "counts": counts,
        "month_payments": {
            "cash": round(sum(float(x.get("amount") or 0) for x in month_payments if x.get("method") == "cash"), 2),
            "bank": round(sum(float(x.get("amount") or 0) for x in month_payments if x.get("method") == "bank"), 2),
        },
        "top_suppliers": sorted([{"id": k, **v} for k, v in supplier_balances.items()], key=lambda x: x["balance"], reverse=True)[:8],
        "branches": sorted([{"id": k, **v} for k, v in branch_balances.items()], key=lambda x: x["balance"], reverse=True),
    }
