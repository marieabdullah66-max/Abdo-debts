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


# V81 - Employee payroll/activity cards inside Abdo Tasks

def _employee_params(employee_id: str, profile: dict[str, Any]) -> dict[str, str]:
    return {"id": f"eq.{employee_id}", "user_id": f"eq.{profile['id']}"}


def _clean_employee_payload(data: EmployeeInput) -> dict[str, Any]:
    return {
        "name": data.name.strip(),
        "base_salary": round(float(data.base_salary or 0), 2),
    }


def _clean_employee_record_payload(data: EmployeeRecordInput) -> dict[str, Any]:
    return {
        "record_type": data.record_type,
        "record_date": data.record_date.isoformat() if data.record_date else date.today().isoformat(),
        "quantity": round(float(data.quantity or 0), 2),
        "amount": round(float(data.amount or 0), 2),
        "note": (data.note or "").strip() or None,
    }


def _month_bounds(month: str | None) -> tuple[str | None, str | None]:
    if not month:
        return None, None
    text = str(month).strip()
    if len(text) != 7 or text[4] != "-" or not (text[:4].isdigit() and text[5:].isdigit()):
        raise HTTPException(422, "صيغة الشهر غير صحيحة")
    year, mon = int(text[:4]), int(text[5:])
    if mon < 1 or mon > 12:
        raise HTTPException(422, "صيغة الشهر غير صحيحة")
    if mon == 12:
        return f"{year:04d}-{mon:02d}-01", f"{year + 1:04d}-01-01"
    return f"{year:04d}-{mon:02d}-01", f"{year:04d}-{mon + 1:02d}-01"


@router.get("/employees")
async def list_employees(profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_employee_records")
    rows = await sb(
        "GET",
        "/rest/v1/employee_cards",
        service=True,
        params={
            "select": "id,name,base_salary,created_at,updated_at",
            "user_id": f"eq.{profile['id']}",
            "order": "name.asc,created_at.asc",
            "limit": "1000",
        },
    )
    return rows or []


@router.post("/employees")
async def create_employee(data: EmployeeInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_employee_records")
    payload = _clean_employee_payload(data)
    payload["user_id"] = profile["id"]
    rows = await sb(
        "POST",
        "/rest/v1/employee_cards",
        service=True,
        headers={"Prefer": "return=representation"},
        json=payload,
    )
    return rows[0]


@router.put("/employees/{employee_id}")
async def update_employee(employee_id: str, data: EmployeeInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_employee_records")
    rows = await sb(
        "PATCH",
        "/rest/v1/employee_cards",
        service=True,
        headers={"Prefer": "return=representation"},
        params=_employee_params(employee_id, profile),
        json=_clean_employee_payload(data),
    )
    if not rows:
        raise HTTPException(404, "الموظف غير موجود")
    return rows[0]


@router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_employee_records")
    await sb("DELETE", "/rest/v1/employee_cards", service=True, params=_employee_params(employee_id, profile))
    return {"ok": True}


@router.get("/employees/{employee_id}/records")
async def list_employee_records(employee_id: str, month: str | None = None, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_employee_records")
    employee = await sb(
        "GET",
        "/rest/v1/employee_cards",
        service=True,
        params={**_employee_params(employee_id, profile), "select": "id", "limit": "1"},
    )
    if not employee:
        raise HTTPException(404, "الموظف غير موجود")
    params: dict[str, str] = {
        "select": "id,employee_id,record_type,record_date,quantity,amount,note,created_at,updated_at",
        "employee_id": f"eq.{employee_id}",
        "user_id": f"eq.{profile['id']}",
        "order": "record_date.desc,created_at.desc",
        "limit": "5000",
    }
    start, end = _month_bounds(month)
    if start and end:
        params["record_date"] = f"gte.{start}"
        # PostgREST cannot express two filters with the same dict key, so use an AND expression.
        params.pop("record_date", None)
        params["and"] = f"(record_date.gte.{start},record_date.lt.{end})"
    rows = await sb("GET", "/rest/v1/employee_records", service=True, params=params)
    return rows or []


@router.post("/employees/{employee_id}/records")
async def create_employee_record(employee_id: str, data: EmployeeRecordInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_employee_records")
    employee = await sb(
        "GET",
        "/rest/v1/employee_cards",
        service=True,
        params={**_employee_params(employee_id, profile), "select": "id", "limit": "1"},
    )
    if not employee:
        raise HTTPException(404, "الموظف غير موجود")
    payload = _clean_employee_record_payload(data)
    payload.update({"user_id": profile["id"], "employee_id": employee_id})
    rows = await sb(
        "POST",
        "/rest/v1/employee_records",
        service=True,
        headers={"Prefer": "return=representation"},
        json=payload,
    )
    return rows[0]


@router.put("/employee-records/{record_id}")
async def update_employee_record(record_id: str, data: EmployeeRecordInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_employee_records")
    rows = await sb(
        "PATCH",
        "/rest/v1/employee_records",
        service=True,
        headers={"Prefer": "return=representation"},
        params={"id": f"eq.{record_id}", "user_id": f"eq.{profile['id']}"},
        json=_clean_employee_record_payload(data),
    )
    if not rows:
        raise HTTPException(404, "السجل غير موجود")
    return rows[0]


@router.delete("/employee-records/{record_id}")
async def delete_employee_record(record_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "use_employee_records")
    await sb(
        "DELETE",
        "/rest/v1/employee_records",
        service=True,
        params={"id": f"eq.{record_id}", "user_id": f"eq.{profile['id']}"},
    )
    return {"ok": True}
