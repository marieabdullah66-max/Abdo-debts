from collections import defaultdict
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException
from ..core import *

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _empty_aging() -> dict[str, Any]:
    return {
        "not_due": {"amount": 0.0, "count": 0},
        "days_0_30": {"amount": 0.0, "count": 0},
        "days_31_60": {"amount": 0.0, "count": 0},
        "days_61_90": {"amount": 0.0, "count": 0},
        "days_90_plus": {"amount": 0.0, "count": 0},
        "total": 0.0,
    }


def _calculate_aging(invoices: list[dict[str, Any]]) -> dict[str, Any]:
    """Age open balances by due date, falling back to invoice date.

    Future due dates stay in ``not_due``. Paid invoices are ignored.
    """
    today = date.today()
    result = _empty_aging()
    for inv in invoices or []:
        balance = round(float(inv.get("balance") or 0), 2)
        if balance <= 0:
            continue
        raw_reference = inv.get("due_date") or inv.get("invoice_date")
        if not raw_reference:
            continue
        try:
            reference = date.fromisoformat(str(raw_reference))
        except ValueError:
            continue
        age_days = (today - reference).days
        if inv.get("due_date") and age_days < 0:
            bucket = "not_due"
        elif age_days <= 30:
            bucket = "days_0_30"
        elif age_days <= 60:
            bucket = "days_31_60"
        elif age_days <= 90:
            bucket = "days_61_90"
        else:
            bucket = "days_90_plus"
        result[bucket]["amount"] = round(result[bucket]["amount"] + balance, 2)
        result[bucket]["count"] += 1
        result["total"] = round(result["total"] + balance, 2)
    return result


def _period_bounds(period: str, from_date: str | None, to_date: str | None) -> tuple[str | None, str | None]:
    today = date.today()
    if period == "this_month":
        start = today.replace(day=1)
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        return start.isoformat(), (next_month - timedelta(days=1)).isoformat()
    if period == "last_month":
        this_month = today.replace(day=1)
        end = this_month - timedelta(days=1)
        return end.replace(day=1).isoformat(), end.isoformat()
    if period == "custom":
        start_obj = None
        end_obj = None
        try:
            start_obj = date.fromisoformat(from_date) if from_date else None
            end_obj = date.fromisoformat(to_date) if to_date else None
        except ValueError:
            raise HTTPException(400, "صيغة التاريخ غير صحيحة")
        if start_obj and end_obj and start_obj > end_obj:
            raise HTTPException(400, "تاريخ البداية يجب أن يكون قبل تاريخ النهاية")
        return start_obj.isoformat() if start_obj else None, end_obj.isoformat() if end_obj else None
    if period not in ("", "all"):
        raise HTTPException(400, "الفترة غير صحيحة")
    return None, None


def _apply_date_bounds(params: dict[str, str], field: str, start: str | None, end: str | None) -> None:
    if start and end:
        params["and"] = f"({field}.gte.{start},{field}.lte.{end})"
    elif start:
        params[field] = f"gte.{start}"
    elif end:
        params[field] = f"lte.{end}"


@router.get("")
async def dashboard(
    branch_id: str | None = None,
    category_id: str | None = None,
    period: str = "all",
    from_date: str | None = None,
    to_date: str | None = None,
    profile: dict[str, Any] = Depends(current_profile),
) -> Any:
    require_permission(profile, "view_dashboard")

    start_date, end_date = _period_bounds(period, from_date, to_date)
    inv_params: dict[str, str] = {
        "select": "id,supplier_id,branch_id,supplier_name,branch_name,amount,paid_amount,balance,status,invoice_date,due_date",
        "limit": "10000",
    }
    pay_params: dict[str, str] = {
        "select": "amount,method,payment_date,branch_id,supplier_id",
        "limit": "10000",
    }
    aging_params: dict[str, str] = {
        "select": "id,supplier_id,branch_id,balance,invoice_date,due_date",
        "limit": "10000",
    }
    inv_params = apply_branch_filter(inv_params, profile)
    pay_params = apply_branch_filter(pay_params, profile)
    aging_params = apply_branch_filter(aging_params, profile)

    if branch_id:
        require_branch_access(profile, branch_id)
        inv_params["branch_id"] = f"eq.{branch_id}"
        pay_params["branch_id"] = f"eq.{branch_id}"
        aging_params["branch_id"] = f"eq.{branch_id}"

    if category_id:
        links = await sb(
            "GET",
            "/rest/v1/supplier_category_links",
            service=True,
            params={"select": "supplier_id", "category_id": f"eq.{category_id}", "limit": "10000"},
        )
        supplier_ids = sorted({str(x.get("supplier_id")) for x in links or [] if x.get("supplier_id")})
        if not supplier_ids:
            return {
                "totals": {"invoiced": 0, "paid": 0, "balance": 0, "overdue": 0},
                "counts": {"unpaid": 0, "partial": 0, "paid": 0},
                "period_payments": {"cash": 0, "bank": 0},
                "month_payments": {"cash": 0, "bank": 0},
                "top_suppliers": [],
                "branches": [],
                "aging": _empty_aging(),
                "filters": {"period": period or "all", "from_date": start_date, "to_date": end_date},
            }
        supplier_filter = f"in.({','.join(supplier_ids)})"
        inv_params["supplier_id"] = supplier_filter
        pay_params["supplier_id"] = supplier_filter
        aging_params["supplier_id"] = supplier_filter

    _apply_date_bounds(inv_params, "invoice_date", start_date, end_date)
    _apply_date_bounds(pay_params, "payment_date", start_date, end_date)

    invoices = await sb("GET", "/rest/v1/invoice_balances", service=True, params=inv_params)
    payments = await sb("GET", "/rest/v1/payments", service=True, params=pay_params)
    aging_invoices = await sb("GET", "/rest/v1/invoice_balances", service=True, params=aging_params)
    aging = _calculate_aging(aging_invoices or [])

    today = date.today().isoformat()
    totals = {
        "invoiced": round(sum(float(x.get("amount") or 0) for x in invoices or []), 2),
        "paid": round(sum(float(x.get("paid_amount") or 0) for x in invoices or []), 2),
        "balance": round(sum(float(x.get("balance") or 0) for x in invoices or []), 2),
        "overdue": round(
            sum(
                float(x.get("balance") or 0)
                for x in invoices or []
                if x.get("due_date") and x["due_date"] < today and float(x.get("balance") or 0) > 0
            ),
            2,
        ),
    }
    counts = {
        status: len([x for x in invoices or [] if x.get("status") == status])
        for status in ("unpaid", "partial", "paid")
    }

    supplier_balances: dict[str, dict[str, Any]] = defaultdict(lambda: {"name": "", "balance": 0.0})
    branch_balances: dict[str, dict[str, Any]] = defaultdict(lambda: {"name": "", "balance": 0.0})
    for inv in invoices or []:
        sid = inv.get("supplier_id")
        bid = inv.get("branch_id")
        supplier_balances[sid]["name"] = inv.get("supplier_name", "")
        supplier_balances[sid]["balance"] += float(inv.get("balance") or 0)
        branch_balances[bid]["name"] = inv.get("branch_name", "")
        branch_balances[bid]["balance"] += float(inv.get("balance") or 0)

    period_payments = {
        "cash": round(sum(float(x.get("amount") or 0) for x in payments or [] if x.get("method") == "cash"), 2),
        "bank": round(sum(float(x.get("amount") or 0) for x in payments or [] if x.get("method") == "bank"), 2),
    }

    return {
        "totals": totals,
        "counts": counts,
        "period_payments": period_payments,
        # Kept for compatibility with any older cached frontend during the PWA upgrade.
        "month_payments": period_payments,
        "top_suppliers": sorted(
            [{"id": k, **v} for k, v in supplier_balances.items()],
            key=lambda x: x["balance"],
            reverse=True,
        )[:8],
        "branches": sorted(
            [{"id": k, **v} for k, v in branch_balances.items()],
            key=lambda x: x["balance"],
            reverse=True,
        ),
        "aging": aging,
        "filters": {"period": period or "all", "from_date": start_date, "to_date": end_date},
    }
