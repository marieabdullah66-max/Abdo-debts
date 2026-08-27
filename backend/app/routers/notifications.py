from __future__ import annotations

from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from ..core import *

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _allowed_event_types(profile: dict[str, Any]) -> list[str]:
    perms = effective_permissions(profile)
    allowed: list[str] = []
    if perms.get("view_invoices"):
        allowed.append("invoice_created")
    if perms.get("view_payments"):
        allowed.append("payment_created")
    return allowed


async def create_notification_event(
    *,
    event_type: str,
    branch_id: str,
    supplier_id: str,
    entity_id: str,
    amount: float,
    profile: dict[str, Any],
    invoice_number: str | None = None,
) -> None:
    """Create a best-effort notification without risking the financial transaction."""
    try:
        supplier_rows = await sb(
            "GET", "/rest/v1/suppliers", service=True,
            params={"select": "name", "id": f"eq.{supplier_id}", "limit": "1"},
        )
        branch_rows = await sb(
            "GET", "/rest/v1/branches", service=True,
            params={"select": "name", "id": f"eq.{branch_id}", "limit": "1"},
        )
        supplier_name = (supplier_rows or [{}])[0].get("name") or "مورد"
        branch_name = (branch_rows or [{}])[0].get("name") or "فرع"
        await sb(
            "POST", "/rest/v1/notifications", service=True,
            headers={"Prefer": "return=minimal"},
            json={
                "event_type": event_type,
                "branch_id": branch_id,
                "supplier_id": supplier_id,
                "entity_id": entity_id,
                "amount": round(float(amount), 2),
                "invoice_number": invoice_number,
                "supplier_name": supplier_name,
                "branch_name": branch_name,
                "actor_id": profile.get("id"),
                "actor_name": profile.get("full_name") or profile.get("username") or "مستخدم",
            },
        )
    except Exception:
        # A notification must never make an already-created invoice/payment look failed.
        return


async def _visible_notifications(profile: dict[str, Any], limit: int = 100) -> list[dict[str, Any]]:
    allowed_types = _allowed_event_types(profile)
    if not allowed_types:
        return []
    params: dict[str, str] = {
        "select": "id,event_type,branch_id,supplier_id,entity_id,amount,invoice_number,supplier_name,branch_name,actor_id,actor_name,created_at",
        "order": "created_at.desc",
        "limit": str(max(1, min(limit, 500))),
    }
    params = apply_branch_filter(params, profile)
    if len(allowed_types) == 1:
        params["event_type"] = f"eq.{allowed_types[0]}"
    else:
        params["event_type"] = f"in.({','.join(allowed_types)})"
    return await sb("GET", "/rest/v1/notifications", service=True, params=params) or []


@router.get("")
async def list_notifications(profile: dict[str, Any] = Depends(current_profile)) -> Any:
    rows = await _visible_notifications(profile, 100)
    if not rows:
        return {"items": [], "unread_count": 0}
    ids = [x["id"] for x in rows]
    read_rows = await sb(
        "GET", "/rest/v1/notification_reads", service=True,
        params={
            "select": "notification_id",
            "profile_id": f"eq.{profile['id']}",
            "notification_id": f"in.({','.join(ids)})",
            "limit": "500",
        },
    ) or []
    read_ids = {x["notification_id"] for x in read_rows}
    items = [{**x, "is_read": x["id"] in read_ids} for x in rows]
    return {"items": items, "unread_count": sum(1 for x in items if not x["is_read"])}


@router.post("/read-all")
async def mark_all_notifications_read(profile: dict[str, Any] = Depends(current_profile)) -> Any:
    rows = await _visible_notifications(profile, 500)
    if not rows:
        return {"ok": True, "count": 0}
    payload = [{"notification_id": x["id"], "profile_id": profile["id"]} for x in rows]
    await sb(
        "POST", "/rest/v1/notification_reads", service=True,
        params={"on_conflict": "notification_id,profile_id"},
        headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        json=payload,
    )
    return {"ok": True, "count": len(payload)}


@router.post("/{notification_id}/read")
async def mark_notification_read(notification_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    rows = await _visible_notifications(profile, 500)
    if notification_id not in {x["id"] for x in rows}:
        raise HTTPException(404, "الإشعار غير موجود")
    await sb(
        "POST", "/rest/v1/notification_reads", service=True,
        params={"on_conflict": "notification_id,profile_id"},
        headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        json={"notification_id": notification_id, "profile_id": profile["id"]},
    )
    return {"ok": True}
