from __future__ import annotations

from uuid import uuid4
from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from ..core import *
from .notifications import create_notification_event

router = APIRouter(prefix="/api/invoices", tags=["invoices"])
BUCKET = "invoice-pdfs"


def _normalize_invoice_number(value: str) -> str:
    return " ".join((value or "").strip().split()).casefold()


async def _ensure_invoice_number_unique(
    supplier_id: str, invoice_number: str, *, exclude_id: str | None = None
) -> None:
    """Prevent the same invoice number from being used twice for one supplier.

    The database migration adds the authoritative trigger. This application-level
    check exists to return a friendly 409 before attempting the insert/update.
    """
    target = _normalize_invoice_number(invoice_number)
    rows = await sb(
        "GET",
        "/rest/v1/invoices",
        service=True,
        params={
            "select": "id,invoice_number",
            "supplier_id": f"eq.{supplier_id}",
            "limit": "10000",
        },
    )
    for row in rows or []:
        if exclude_id and str(row.get("id")) == str(exclude_id):
            continue
        if _normalize_invoice_number(str(row.get("invoice_number") or "")) == target:
            raise HTTPException(409, "رقم الفاتورة موجود مسبقًا لهذا المورد ولا يمكن تكراره")

async def _invoice(invoice_id: str) -> dict[str, Any]:
    rows = await sb("GET", "/rest/v1/invoices", service=True, params={
        "select": "id,supplier_id,branch_id,invoice_number,amount,invoice_date,due_date,notes,pdf_path,suppliers(name),branches(name)",
        "id": f"eq.{invoice_id}", "limit": "1"
    })
    if not rows:
        raise HTTPException(404, "الفاتورة غير موجودة")
    return rows[0]

@router.get("")
async def list_invoices(
    supplier_id: str | None = None, branch_id: str | None = None, status: str | None = None,
    q: str | None = None, profile: dict[str, Any] = Depends(current_profile)
) -> Any:
    require_permission(profile, "view_invoices")
    params: dict[str, str] = {
        "select": "id,supplier_id,branch_id,supplier_name,branch_name,invoice_number,amount,paid_amount,balance,status,invoice_date,due_date,notes,pdf_path,created_at",
        "order": "invoice_date.desc,created_at.desc", "limit": "5000"
    }
    params = apply_branch_filter(params, profile)
    if branch_id:
        require_branch_access(profile, branch_id)
        params["branch_id"] = f"eq.{branch_id}"
    if supplier_id:
        params["supplier_id"] = f"eq.{supplier_id}"
    if status in {"unpaid", "partial", "paid"}:
        params["status"] = f"eq.{status}"
    if q:
        safe = q.strip().replace("%", "")[:80]
        if safe:
            params["invoice_number"] = f"ilike.*{safe}*"
    rows = await sb("GET", "/rest/v1/invoice_balances", service=True, params=params)
    for row in rows or []:
        row["suppliers"] = {"name": row.get("supplier_name")}
        row["branches"] = {"name": row.get("branch_name")}
    return rows

@router.post("")
async def create_invoice(data: InvoiceInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "create_invoices")
    require_branch_access(profile, data.branch_id)
    supplier = await sb("GET", "/rest/v1/suppliers", service=True, params={"select": "id", "id": f"eq.{data.supplier_id}", "active": "eq.true", "limit": "1"})
    if not supplier:
        raise HTTPException(422, "المورد غير موجود")
    await _ensure_invoice_number_unique(data.supplier_id, data.invoice_number)
    rows = await sb("POST", "/rest/v1/invoices", service=True, headers={"Prefer": "return=representation"}, json={
        "supplier_id": data.supplier_id, "branch_id": data.branch_id, "invoice_number": data.invoice_number.strip(),
        "amount": round(data.amount, 2), "invoice_date": data.invoice_date.isoformat(),
        "due_date": data.due_date.isoformat() if data.due_date else None, "notes": (data.notes or "").strip() or None,
        "created_by": profile["id"],
    })
    result = rows[0]
    await create_notification_event(
        event_type="invoice_created", branch_id=data.branch_id, supplier_id=data.supplier_id,
        entity_id=str(result["id"]), amount=data.amount, profile=profile,
        invoice_number=data.invoice_number.strip(),
    )
    return result

@router.put("/{invoice_id}")
async def update_invoice(invoice_id: str, data: InvoiceUpdateInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "edit_invoices")
    current = await _invoice(invoice_id)
    require_branch_access(profile, current["branch_id"])
    require_branch_access(profile, data.branch_id)
    allocations = await sb("GET", "/rest/v1/payment_allocations", service=True, params={"select": "amount", "invoice_id": f"eq.{invoice_id}", "limit": "10000"})
    paid = round(sum(float(x.get("amount") or 0) for x in allocations or []), 2)
    if allocations and (data.supplier_id != current["supplier_id"] or data.branch_id != current["branch_id"]):
        raise HTTPException(409, "لا يمكن تغيير المورد أو الفرع لفاتورة عليها سدادات؛ عدّل أو احذف السداد أولاً")
    if round(data.amount, 2) < paid:
        raise HTTPException(422, f"قيمة الفاتورة لا يمكن أن تقل عن المسدد ({paid:.2f})")
    current_number = _normalize_invoice_number(str(current.get("invoice_number") or ""))
    new_number = _normalize_invoice_number(data.invoice_number)
    if data.supplier_id != current["supplier_id"] or new_number != current_number:
        await _ensure_invoice_number_unique(data.supplier_id, data.invoice_number, exclude_id=invoice_id)
    rows = await sb("PATCH", "/rest/v1/invoices", service=True, headers={"Prefer": "return=representation"}, params={"id": f"eq.{invoice_id}"}, json={
        "supplier_id": data.supplier_id, "branch_id": data.branch_id, "invoice_number": data.invoice_number.strip(),
        "amount": round(data.amount, 2), "invoice_date": data.invoice_date.isoformat(),
        "due_date": data.due_date.isoformat() if data.due_date else None, "notes": (data.notes or "").strip() or None,
    })
    return rows[0]

@router.delete("/{invoice_id}")
async def delete_invoice(invoice_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "delete_invoices")
    current = await _invoice(invoice_id)
    require_branch_access(profile, current["branch_id"])
    linked = await sb("GET", "/rest/v1/payment_allocations", service=True, params={"select": "id", "invoice_id": f"eq.{invoice_id}", "limit": "1"})
    if linked:
        raise HTTPException(409, "لا يمكن حذف فاتورة عليها سدادات؛ عدّل أو احذف السداد أولاً")
    if current.get("pdf_path"):
        try:
            await sb("DELETE", f"/storage/v1/object/{BUCKET}/{current['pdf_path']}", service=True)
        except Exception:
            pass
    await sb("DELETE", "/rest/v1/invoices", service=True, params={"id": f"eq.{invoice_id}"})
    return {"ok": True}

@router.post("/{invoice_id}/pdf")
async def upload_invoice_pdf(invoice_id: str, file: UploadFile = File(...), profile: dict[str, Any] = Depends(current_profile)) -> Any:
    if not (effective_permissions(profile).get("edit_invoices") or effective_permissions(profile).get("create_invoices")):
        raise HTTPException(403, "ليس لديك صلاحية إرفاق PDF للفاتورة")
    invoice = await _invoice(invoice_id)
    require_branch_access(profile, invoice["branch_id"])
    if file.content_type != "application/pdf" and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(422, "يسمح بملفات PDF فقط")
    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "حجم PDF يجب ألا يتجاوز 10 MB")
    path = f"{invoice['branch_id']}/{invoice_id}/{uuid4().hex}.pdf"
    require_service_key()
    response = await get_http_client().request(
        "POST", f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{path}",
        headers={**api_headers(service=True, content_type="application/pdf"), "x-upsert": "true"}, content=content,
    )
    if response.status_code >= 400:
        raise HTTPException(response.status_code, response.text)
    old = invoice.get("pdf_path")
    await sb("PATCH", "/rest/v1/invoices", service=True, params={"id": f"eq.{invoice_id}"}, json={"pdf_path": path})
    if old and old != path:
        try:
            await sb("DELETE", f"/storage/v1/object/{BUCKET}/{old}", service=True)
        except Exception:
            pass
    return {"ok": True, "pdf_path": path}

@router.get("/{invoice_id}/pdf")
async def view_invoice_pdf(invoice_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Response:
    require_permission(profile, "view_invoices")
    invoice = await _invoice(invoice_id)
    require_branch_access(profile, invoice["branch_id"])
    if not invoice.get("pdf_path"):
        raise HTTPException(404, "لا يوجد PDF مرفق")
    require_service_key()
    response = await get_http_client().get(
        f"{SUPABASE_URL}/storage/v1/object/authenticated/{BUCKET}/{invoice['pdf_path']}", headers=api_headers(service=True, content_type="")
    )
    if response.status_code >= 400:
        raise HTTPException(response.status_code, "تعذر قراءة ملف PDF")
    return Response(content=response.content, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="invoice-{invoice["invoice_number"]}.pdf"'})
