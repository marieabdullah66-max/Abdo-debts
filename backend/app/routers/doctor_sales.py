from __future__ import annotations

import csv
import io
import re
import unicodedata
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..core import current_profile, require_permission

router = APIRouter(prefix="/api/doctor-sales", tags=["doctor-sales"])

MAX_REPORT_BYTES = 20 * 1024 * 1024
MAX_REPORT_ROWS = 100000

SALE_PREFIX = "مبيعات"
RETURN_WORD = "مردود"


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").casefold().strip()
    return " ".join(value.split())


def _number(value: Any) -> float:
    if value is None:
        return 0.0
    text = str(value).strip().replace(",", "")
    if not text:
        return 0.0
    negative = False
    if text.endswith("-"):
        negative = True
        text = text[:-1].strip()
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1].strip()
    try:
        result = float(text)
    except ValueError:
        return 0.0
    return -abs(result) if negative else result


def _decode_csv(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1256"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(422, "تعذر قراءة ترميز ملف CSV")


def _label_value(row: list[str], label: str) -> str:
    target = _normalize(label.replace("：", ":"))
    for index, value in enumerate(row):
        current = _normalize(_text(value).replace("：", ":"))
        if current == target and index > 0:
            return _text(row[index - 1])
    return ""


def _item_values(row: list[str]) -> dict[str, str]:
    headers = ["الإجمالي", "السعر", "التعبئة", "الكمية", "اسم الصنف", "ر.ت"]
    positions: list[int] = []
    for header in headers:
        try:
            positions.append(next(i for i, value in enumerate(row) if _text(value) == header))
        except StopIteration:
            return {}
    if positions != list(range(positions[0], positions[0] + len(headers))):
        return {}
    values_start = positions[-1] + 1
    if len(row) < values_start + len(headers):
        return {}
    values = row[values_start: values_start + len(headers)]
    return dict(zip(headers, map(_text, values)))


def _period_and_source(rows: list[list[str]]) -> tuple[str, str, str]:
    if not rows:
        return "", "", ""
    first = rows[0]
    period_start = _label_value(first, ": من")
    period_end = _label_value(first, ": إلي") or _label_value(first, ": إلى")
    source = _text(first[2]) if len(first) > 2 else ""
    return period_start, period_end, source


def analyze_doctor_sales_rows(rows: list[list[str]]) -> dict[str, Any]:
    period_start, period_end, source = _period_and_source(rows)

    doctors: dict[str, dict[str, Any]] = {}
    invoice_items: dict[tuple[str, str], set[str]] = defaultdict(set)
    seen_invoices: set[tuple[str, str, str]] = set()
    global_items: set[str] = set()

    processed_rows = 0
    skipped_rows = 0

    for row_index, row in enumerate(rows, start=1):
        movement_type = _label_value(row, ": نوع الحركة")
        is_return = RETURN_WORD in movement_type
        is_sale = movement_type.startswith(SALE_PREFIX) and not is_return
        if not is_sale and not is_return:
            continue

        doctor = _label_value(row, ": المستخدم")
        movement_number = _label_value(row, ": رقم الحركة")
        if not doctor or not movement_number:
            skipped_rows += 1
            continue

        item = _item_values(row)
        item_name = _text(item.get("اسم الصنف"))
        item_ref = _text(item.get("ر.ت"))
        quantity = abs(_number(item.get("الكمية")))
        package = _text(item.get("التعبئة"))

        invoice_total = abs(_number(_label_value(row, ": الإجمالي")))
        discount = abs(_number(_label_value(row, ": الخصم")))
        invoice_net = max(0.0, invoice_total - discount)

        doctor_key = _normalize(doctor)
        if not doctor_key:
            skipped_rows += 1
            continue

        bucket = doctors.setdefault(doctor_key, {
            "doctor": doctor,
            "sales_total": 0.0,
            "returns_total": 0.0,
            "net_sales": 0.0,
            "invoice_count": 0,
            "return_count": 0,
            "cash_invoice_count": 0,
            "credit_invoice_count": 0,
            "cash_sales": 0.0,
            "credit_sales": 0.0,
            "unique_items": set(),
            "sales_lines": 0,
            "boxes_quantity": 0.0,
            "loose_quantity": 0.0,
        })
        if len(doctor) > len(bucket["doctor"]):
            bucket["doctor"] = doctor

        category = "return" if is_return else "sale"
        invoice_key = (doctor_key, category, movement_number)
        if invoice_key not in seen_invoices:
            seen_invoices.add(invoice_key)
            if is_return:
                bucket["returns_total"] += invoice_net
                bucket["return_count"] += 1
            else:
                bucket["sales_total"] += invoice_net
                bucket["invoice_count"] += 1
                if "الآجل" in movement_type:
                    bucket["credit_invoice_count"] += 1
                    bucket["credit_sales"] += invoice_net
                else:
                    bucket["cash_invoice_count"] += 1
                    bucket["cash_sales"] += invoice_net

        if is_sale and item_name:
            normalized_item = _normalize(item_name)
            identity = f"ref:{item_ref}" if item_ref and item_ref != "0" else f"name:{normalized_item}"
            bucket["unique_items"].add(identity)
            global_items.add(identity)
            bucket["sales_lines"] += 1
            invoice_items[(doctor_key, movement_number)].add(identity)
            if package == "علبة":
                bucket["boxes_quantity"] += quantity
            elif package == "فرط":
                bucket["loose_quantity"] += quantity

        processed_rows += 1

    if not doctors:
        raise HTTPException(422, "لم نجد مبيعات مرتبطة بمستخدمين داخل التقرير")

    result_doctors: list[dict[str, Any]] = []
    for doctor_key, bucket in doctors.items():
        invoice_count = int(bucket["invoice_count"])
        sales_total = round(float(bucket["sales_total"]), 3)
        returns_total = round(float(bucket["returns_total"]), 3)
        net_sales = round(sales_total - returns_total, 3)
        average_invoice = round(sales_total / invoice_count, 3) if invoice_count else 0.0
        total_invoice_items = sum(
            len(items) for (key, _movement), items in invoice_items.items() if key == doctor_key
        )
        avg_items_per_invoice = round(total_invoice_items / invoice_count, 2) if invoice_count else 0.0
        result_doctors.append({
            "doctor": bucket["doctor"],
            "sales_total": sales_total,
            "returns_total": returns_total,
            "net_sales": net_sales,
            "invoice_count": invoice_count,
            "return_count": int(bucket["return_count"]),
            "average_invoice": average_invoice,
            "unique_items": len(bucket["unique_items"]),
            "average_items_per_invoice": avg_items_per_invoice,
            "sales_lines": int(bucket["sales_lines"]),
            "boxes_quantity": round(float(bucket["boxes_quantity"]), 2),
            "loose_quantity": round(float(bucket["loose_quantity"]), 2),
            "cash_invoice_count": int(bucket["cash_invoice_count"]),
            "credit_invoice_count": int(bucket["credit_invoice_count"]),
            "cash_sales": round(float(bucket["cash_sales"]), 3),
            "credit_sales": round(float(bucket["credit_sales"]), 3),
        })

    result_doctors.sort(key=lambda item: (item["net_sales"], item["sales_total"]), reverse=True)

    total_sales = round(sum(item["sales_total"] for item in result_doctors), 3)
    total_returns = round(sum(item["returns_total"] for item in result_doctors), 3)
    total_invoices = sum(item["invoice_count"] for item in result_doctors)

    return {
        "source": source,
        "period_start": period_start,
        "period_end": period_end,
        "doctor_count": len(result_doctors),
        "processed_rows": processed_rows,
        "skipped_rows": skipped_rows,
        "totals": {
            "sales_total": total_sales,
            "returns_total": total_returns,
            "net_sales": round(total_sales - total_returns, 3),
            "invoice_count": total_invoices,
            "average_invoice": round(total_sales / total_invoices, 3) if total_invoices else 0.0,
            "unique_items": len(global_items),
        },
        "doctors": result_doctors,
    }


@router.post("/analyze")
async def analyze_doctor_sales(
    file: UploadFile = File(...),
    profile: dict[str, Any] = Depends(current_profile),
) -> dict[str, Any]:
    require_permission(profile, "view_doctor_sales")
    filename = (file.filename or "").lower()
    if not filename.endswith(".csv"):
        raise HTTPException(422, "ارفع تقرير المبيعات بصيغة CSV")

    content = await file.read(MAX_REPORT_BYTES + 1)
    if not content:
        raise HTTPException(422, "ملف التقرير فارغ")
    if len(content) > MAX_REPORT_BYTES:
        raise HTTPException(413, "حجم تقرير المبيعات أكبر من 20 MB")

    text = _decode_csv(content)
    reader = csv.reader(io.StringIO(text))
    rows: list[list[str]] = []
    for index, row in enumerate(reader):
        if index >= MAX_REPORT_ROWS:
            break
        rows.append(row)

    return analyze_doctor_sales_rows(rows)
