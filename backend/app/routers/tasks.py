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


def _book_params(book_id: str, profile: dict[str, Any]) -> dict[str, str]:
    return {"id": f"eq.{book_id}", "user_id": f"eq.{profile['id']}"}


async def _touch_note_book(book_id: str, profile: dict[str, Any]) -> None:
    rows = await sb("GET", "/rest/v1/daily_note_books", service=True, params={**_book_params(book_id, profile), "select": "title", "limit": "1"})
    if rows:
        await sb("PATCH", "/rest/v1/daily_note_books", service=True, params=_book_params(book_id, profile), json={"title": rows[0].get("title") or "ملاحظات"})


@router.get("/note-books")
async def list_note_books(profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_daily_notes")
    rows = await sb(
        "GET",
        "/rest/v1/daily_note_books",
        service=True,
        params={
            "select": "id,title,created_at,updated_at",
            "user_id": f"eq.{profile['id']}",
            "order": "updated_at.desc,created_at.desc",
            "limit": "1000",
        },
    )
    return rows or []


@router.post("/note-books")
async def create_note_book(data: DailyNoteBookInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_daily_notes")
    title = data.title.strip()
    rows = await sb(
        "POST",
        "/rest/v1/daily_note_books",
        service=True,
        headers={"Prefer": "return=representation"},
        json={"user_id": profile["id"], "title": title},
    )
    return rows[0]


@router.put("/note-books/{book_id}")
async def update_note_book(book_id: str, data: DailyNoteBookInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_daily_notes")
    rows = await sb(
        "PATCH",
        "/rest/v1/daily_note_books",
        service=True,
        headers={"Prefer": "return=representation"},
        params=_book_params(book_id, profile),
        json={"title": data.title.strip()},
    )
    if not rows:
        raise HTTPException(404, "العنوان غير موجود")
    return rows[0]


@router.delete("/note-books/{book_id}")
async def delete_note_book(book_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_daily_notes")
    await sb("DELETE", "/rest/v1/daily_note_books", service=True, params=_book_params(book_id, profile))
    return {"ok": True}


@router.get("/note-books/{book_id}/notes")
async def list_daily_notes(book_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_daily_notes")
    rows = await sb(
        "GET",
        "/rest/v1/daily_notes",
        service=True,
        params={
            "select": "id,book_id,note_text,note_date,priority,followed_up,created_at,updated_at",
            "book_id": f"eq.{book_id}",
            "user_id": f"eq.{profile['id']}",
            "order": "note_date.desc,created_at.desc",
            "limit": "1000",
        },
    )
    return rows or []


@router.post("/note-books/{book_id}/notes")
async def create_daily_note(book_id: str, data: DailyNoteInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_daily_notes")
    book = await sb("GET", "/rest/v1/daily_note_books", service=True, params={**_book_params(book_id, profile), "select": "id", "limit": "1"})
    if not book:
        raise HTTPException(404, "العنوان غير موجود")
    rows = await sb(
        "POST",
        "/rest/v1/daily_notes",
        service=True,
        headers={"Prefer": "return=representation"},
        json={
            "user_id": profile["id"],
            "book_id": book_id,
            "note_text": data.note_text.strip(),
            "note_date": data.note_date.isoformat() if data.note_date else None,
            "priority": data.priority,
            "followed_up": bool(data.followed_up),
        },
    )
    await _touch_note_book(book_id, profile)
    return rows[0]


@router.put("/notes/{note_id}")
async def update_daily_note(note_id: str, data: DailyNoteInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_daily_notes")
    rows = await sb(
        "PATCH",
        "/rest/v1/daily_notes",
        service=True,
        headers={"Prefer": "return=representation"},
        params={"id": f"eq.{note_id}", "user_id": f"eq.{profile['id']}"},
        json={
            "note_text": data.note_text.strip(),
            "note_date": data.note_date.isoformat() if data.note_date else None,
            "priority": data.priority,
            "followed_up": bool(data.followed_up),
        },
    )
    if not rows:
        raise HTTPException(404, "الملاحظة غير موجودة")
    await _touch_note_book(rows[0]["book_id"], profile)
    return rows[0]


@router.post("/notes/{note_id}/follow-up")
async def follow_up_daily_note(note_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_daily_notes")
    rows = await sb(
        "PATCH",
        "/rest/v1/daily_notes",
        service=True,
        headers={"Prefer": "return=representation"},
        params={"id": f"eq.{note_id}", "user_id": f"eq.{profile['id']}"},
        json={"followed_up": True},
    )
    if not rows:
        raise HTTPException(404, "الملاحظة غير موجودة")
    await _touch_note_book(rows[0]["book_id"], profile)
    return rows[0]


@router.delete("/notes/{note_id}")
async def delete_daily_note(note_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_daily_notes")
    await sb("DELETE", "/rest/v1/daily_notes", service=True, params={"id": f"eq.{note_id}", "user_id": f"eq.{profile['id']}"})
    return {"ok": True}
