from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..core import *

router = APIRouter(prefix="/api/payment-plans", tags=["payment-plans"])

OPEN_STATUSES = {"planned", "postponed"}
LOCAL_TZ = ZoneInfo("Africa/Tripoli")


def _today() -> date:
    return datetime.now(LOCAL_TZ).date()


def _status_for(row: dict[str, Any], today: date) -> tuple[str, int | None]:
    stored = row.get("status") or "planned"
    if stored in {"completed", "cancelled"}:
        return stored, None
    try:
        planned_date = date.fromisoformat(str(row.get("planned_date")))
    except (TypeError, ValueError):
        return stored, None
    days = (planned_date - today).days
    if days < 0:
        return "overdue", days
    if days == 0:
        return "due_today", 0
    if stored == "postponed":
        return "postponed", days
    return "planned", days


async def _supplier_branch_balance(supplier_id: str, branch_id: str) -> float:
    rows = await sb(
        "GET", "/rest/v1/invoice_balances", service=True,
        params={
            "select": "balance",
            "supplier_id": f"eq.{supplier_id}",
            "branch_id": f"eq.{branch_id}",
            "limit": "10000",
        },
    )
    return round(sum(float(x.get("balance") or 0) for x in rows or []), 2)


async def _open_plan_total(supplier_id: str, branch_id: str, exclude_id: str | None = None) -> float:
    params: dict[str, str] = {
        "select": "id,planned_amount",
        "supplier_id": f"eq.{supplier_id}",
        "branch_id": f"eq.{branch_id}",
        "status": "in.(planned,postponed)",
        "limit": "5000",
    }
    if exclude_id:
        params["id"] = f"neq.{exclude_id}"
    rows = await sb("GET", "/rest/v1/payment_plans", service=True, params=params)
    return round(sum(float(x.get("planned_amount") or 0) for x in rows or []), 2)


async def _validate_plan(data: PaymentPlanInput, profile: dict[str, Any], exclude_id: str | None = None) -> float:
    require_branch_access(profile, data.branch_id)
    supplier = await sb(
        "GET", "/rest/v1/suppliers", service=True,
        params={"select": "id", "id": f"eq.{data.supplier_id}", "active": "eq.true", "limit": "1"},
    )
    if not supplier:
        raise HTTPException(422, "المورد غير موجود")
    branch = await sb(
        "GET", "/rest/v1/branches", service=True,
        params={"select": "id", "id": f"eq.{data.branch_id}", "active": "eq.true", "limit": "1"},
    )
    if not branch:
        raise HTTPException(422, "الفرع غير موجود أو موقوف")
    balance = await _supplier_branch_balance(data.supplier_id, data.branch_id)
    if balance <= 0:
        raise HTTPException(422, "لا يوجد رصيد مستحق لهذا المورد في الفرع المحدد")
    already_planned = await _open_plan_total(data.supplier_id, data.branch_id, exclude_id=exclude_id)
    if round(already_planned + data.planned_amount, 2) > round(balance, 2):
        available = max(0.0, round(balance - already_planned, 2))
        raise HTTPException(422, f"المبلغ المخطط يتجاوز الرصيد غير المخطط. المتاح للخطة: {available:.2f} د.ل")
    return balance


async def _plan(plan_id: str) -> dict[str, Any]:
    rows = await sb(
        "GET", "/rest/v1/payment_plans", service=True,
        params={
            "select": "id,supplier_id,branch_id,planned_amount,planned_date,notes,status,postpone_count,last_postpone_reason,completed_payment_id,completed_at,created_by,created_at,updated_at",
            "id": f"eq.{plan_id}", "limit": "1",
        },
    )
    if not rows:
        raise HTTPException(404, "موعد السداد غير موجود")
    return rows[0]


async def _decorate(rows: list[dict[str, Any]], profile: dict[str, Any]) -> list[dict[str, Any]]:
    today = _today()
    # One balance query keeps the list useful without one request per plan.
    inv_params: dict[str, str] = {"select": "supplier_id,branch_id,balance", "limit": "10000"}
    inv_params = apply_branch_filter(inv_params, profile)
    invoices = await sb("GET", "/rest/v1/invoice_balances", service=True, params=inv_params) or []
    balances: dict[tuple[str, str], float] = {}
    for inv in invoices:
        key = (inv.get("supplier_id"), inv.get("branch_id"))
        balances[key] = balances.get(key, 0.0) + float(inv.get("balance") or 0)

    payment_ids = [str(x.get("completed_payment_id")) for x in rows if x.get("completed_payment_id")]
    payments_by_id: dict[str, dict[str, Any]] = {}
    if payment_ids:
        payments = await sb(
            "GET", "/rest/v1/payments", service=True,
            params={"select": "id,amount,payment_date", "id": f"in.({','.join(payment_ids)})", "limit": str(max(100, len(payment_ids)))},
        ) or []
        payments_by_id = {str(x.get("id")): x for x in payments}

    result: list[dict[str, Any]] = []
    for row in rows:
        display_status, days_to_due = _status_for(row, today)
        supplier = row.get("suppliers") or {}
        branch = row.get("branches") or {}
        completed_payment = payments_by_id.get(str(row.get("completed_payment_id"))) if row.get("completed_payment_id") else None
        result.append({
            **row,
            "supplier_name": supplier.get("name") or "",
            "branch_name": branch.get("name") or "",
            "display_status": display_status,
            "days_to_due": days_to_due,
            "current_balance": round(balances.get((row.get("supplier_id"), row.get("branch_id")), 0.0), 2),
            "actual_amount": float(completed_payment.get("amount") or 0) if completed_payment else None,
            "actual_payment_date": completed_payment.get("payment_date") if completed_payment else None,
        })
    return result


def _summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    today = _today()
    next_week = today + timedelta(days=7)
    summary = {"overdue": 0.0, "due_today": 0.0, "next_7_days": 0.0, "later": 0.0, "open_total": 0.0, "open_count": 0}
    for row in rows:
        if row.get("status") not in OPEN_STATUSES:
            continue
        try:
            d = date.fromisoformat(str(row.get("planned_date")))
        except (TypeError, ValueError):
            continue
        amount = float(row.get("planned_amount") or 0)
        summary["open_total"] += amount
        summary["open_count"] += 1
        if d < today:
            summary["overdue"] += amount
        elif d == today:
            summary["due_today"] += amount
        elif d <= next_week:
            summary["next_7_days"] += amount
        else:
            summary["later"] += amount
    for key in ("overdue", "due_today", "next_7_days", "later", "open_total"):
        summary[key] = round(summary[key], 2)
    return summary


@router.get("")
async def list_payment_plans(
    branch_id: str | None = None,
    supplier_id: str | None = None,
    profile: dict[str, Any] = Depends(current_profile),
) -> Any:
    require_permission(profile, "view_payment_plans")
    params: dict[str, str] = {
        "select": "id,supplier_id,branch_id,planned_amount,planned_date,notes,status,postpone_count,last_postpone_reason,completed_payment_id,completed_at,created_by,created_at,updated_at,suppliers(name),branches(name)",
        "order": "planned_date.asc,created_at.asc",
        "limit": "5000",
    }
    params = apply_branch_filter(params, profile)
    if branch_id:
        require_branch_access(profile, branch_id)
        params["branch_id"] = f"eq.{branch_id}"
    if supplier_id:
        params["supplier_id"] = f"eq.{supplier_id}"
    rows = await sb("GET", "/rest/v1/payment_plans", service=True, params=params) or []
    decorated = await _decorate(rows, profile)
    return {"items": decorated, "summary": _summary(rows)}


@router.post("")
async def create_payment_plan(data: PaymentPlanInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_payment_plans")
    if data.planned_date < _today():
        raise HTTPException(422, "موعد السداد لا يمكن أن يكون في الماضي")
    await _validate_plan(data, profile)
    rows = await sb(
        "POST", "/rest/v1/payment_plans", service=True,
        headers={"Prefer": "return=representation"},
        json={
            "supplier_id": data.supplier_id,
            "branch_id": data.branch_id,
            "planned_amount": round(data.planned_amount, 2),
            "planned_date": data.planned_date.isoformat(),
            "notes": (data.notes or "").strip() or None,
            "status": "planned",
            "created_by": profile["id"],
        },
    )
    return rows[0]


@router.put("/{plan_id}")
async def update_payment_plan(plan_id: str, data: PaymentPlanInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_payment_plans")
    current = await _plan(plan_id)
    require_branch_access(profile, current["branch_id"])
    if current.get("status") not in OPEN_STATUSES:
        raise HTTPException(409, "لا يمكن تعديل خطة منتهية أو ملغاة")
    if data.planned_date < _today():
        raise HTTPException(422, "موعد السداد لا يمكن أن يكون في الماضي")
    await _validate_plan(data, profile, exclude_id=plan_id)
    rows = await sb(
        "PATCH", "/rest/v1/payment_plans", service=True,
        headers={"Prefer": "return=representation"},
        params={"id": f"eq.{plan_id}"},
        json={
            "supplier_id": data.supplier_id,
            "branch_id": data.branch_id,
            "planned_amount": round(data.planned_amount, 2),
            "planned_date": data.planned_date.isoformat(),
            "notes": (data.notes or "").strip() or None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return rows[0]


@router.post("/{plan_id}/postpone")
async def postpone_payment_plan(plan_id: str, data: PaymentPlanPostponeInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_payment_plans")
    current = await _plan(plan_id)
    require_branch_access(profile, current["branch_id"])
    if current.get("status") not in OPEN_STATUSES:
        raise HTTPException(409, "لا يمكن تأجيل خطة منتهية أو ملغاة")
    try:
        old_date = date.fromisoformat(str(current.get("planned_date")))
    except ValueError:
        old_date = _today()
    if data.planned_date < _today() or data.planned_date <= old_date:
        raise HTTPException(422, "تاريخ التأجيل الجديد يجب أن يكون بعد الموعد الحالي وليس في الماضي")
    rows = await sb(
        "PATCH", "/rest/v1/payment_plans", service=True,
        headers={"Prefer": "return=representation"},
        params={"id": f"eq.{plan_id}"},
        json={
            "planned_date": data.planned_date.isoformat(),
            "status": "postponed",
            "postpone_count": int(current.get("postpone_count") or 0) + 1,
            "last_postpone_reason": data.reason.strip(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return rows[0]


@router.post("/{plan_id}/complete")
async def complete_payment_plan(plan_id: str, data: PaymentPlanCompleteInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_payment_plans")
    current = await _plan(plan_id)
    require_branch_access(profile, current["branch_id"])
    if current.get("status") not in OPEN_STATUSES:
        raise HTTPException(409, "الخطة منتهية أو ملغاة بالفعل")
    payment_id = (data.payment_id or "").strip() or None
    if payment_id:
        payment = await sb(
            "GET", "/rest/v1/payments", service=True,
            params={"select": "id,supplier_id,branch_id", "id": f"eq.{payment_id}", "limit": "1"},
        )
        if not payment:
            raise HTTPException(422, "السداد المرتبط غير موجود")
        if payment[0].get("supplier_id") != current.get("supplier_id") or payment[0].get("branch_id") != current.get("branch_id"):
            raise HTTPException(422, "السداد يجب أن يكون لنفس المورد والفرع")
    rows = await sb(
        "PATCH", "/rest/v1/payment_plans", service=True,
        headers={"Prefer": "return=representation"},
        params={"id": f"eq.{plan_id}"},
        json={
            "status": "completed",
            "completed_payment_id": payment_id,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return rows[0]


@router.post("/{plan_id}/cancel")
async def cancel_payment_plan(plan_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_payment_plans")
    current = await _plan(plan_id)
    require_branch_access(profile, current["branch_id"])
    if current.get("status") not in OPEN_STATUSES:
        raise HTTPException(409, "الخطة منتهية أو ملغاة بالفعل")
    rows = await sb(
        "PATCH", "/rest/v1/payment_plans", service=True,
        headers={"Prefer": "return=representation"},
        params={"id": f"eq.{plan_id}"},
        json={
            "status": "cancelled",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return rows[0]
