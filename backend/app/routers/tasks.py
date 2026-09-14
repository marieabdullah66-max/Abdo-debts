from __future__ import annotations

from typing import Any
from fastapi import APIRouter, Depends

from ..core import *

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _clean_task_payload(data: TaskInput, profile: dict[str, Any]) -> dict[str, Any]:
    branch_id = (data.branch_id or None)
    if branch_id:
        require_branch_access(profile, branch_id)
    return {
        "title": data.title.strip(),
        "description": (data.description or "").strip() or None,
        "priority": data.priority,
        "status": data.status,
        "due_date": data.due_date.isoformat() if data.due_date else None,
        "branch_id": branch_id,
    }


@router.get("")
async def list_tasks(profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_tasks")
    rows = await sb(
        "GET",
        "/rest/v1/tasks",
        service=True,
        params={
            "select": "id,title,description,priority,status,due_date,branch_id,created_at,updated_at,branches(name)",
            "user_id": f"eq.{profile['id']}",
            "order": "due_date.asc.nullslast,created_at.desc",
            "limit": "1000",
        },
    )
    return rows or []


@router.post("")
async def create_task(data: TaskInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_tasks")
    payload = _clean_task_payload(data, profile)
    payload["user_id"] = profile["id"]
    rows = await sb(
        "POST",
        "/rest/v1/tasks",
        service=True,
        headers={"Prefer": "return=representation"},
        json=payload,
    )
    return rows[0]


@router.put("/{task_id}")
async def update_task(task_id: str, data: TaskInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_tasks")
    payload = _clean_task_payload(data, profile)
    rows = await sb(
        "PATCH",
        "/rest/v1/tasks",
        service=True,
        headers={"Prefer": "return=representation"},
        params={"id": f"eq.{task_id}", "user_id": f"eq.{profile['id']}"},
        json=payload,
    )
    if not rows:
        raise HTTPException(404, "المهمة غير موجودة")
    return rows[0]


@router.post("/{task_id}/complete")
async def complete_task(task_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_tasks")
    rows = await sb(
        "PATCH",
        "/rest/v1/tasks",
        service=True,
        headers={"Prefer": "return=representation"},
        params={"id": f"eq.{task_id}", "user_id": f"eq.{profile['id']}"},
        json={"status": "completed"},
    )
    if not rows:
        raise HTTPException(404, "المهمة غير موجودة")
    return rows[0]


@router.post("/{task_id}/postpone")
async def postpone_task(task_id: str, data: TaskPostponeInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_tasks")
    rows = await sb(
        "PATCH",
        "/rest/v1/tasks",
        service=True,
        headers={"Prefer": "return=representation"},
        params={"id": f"eq.{task_id}", "user_id": f"eq.{profile['id']}"},
        json={"status": "postponed", "due_date": data.due_date.isoformat()},
    )
    if not rows:
        raise HTTPException(404, "المهمة غير موجودة")
    return rows[0]


@router.delete("/{task_id}")
async def delete_task(task_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_tasks")
    await sb("DELETE", "/rest/v1/tasks", service=True, params={"id": f"eq.{task_id}", "user_id": f"eq.{profile['id']}"})
    return {"ok": True}
