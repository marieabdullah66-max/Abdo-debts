from __future__ import annotations

import csv
import io
import unicodedata
from collections import defaultdict
from statistics import median, pstdev
from typing import Any
from datetime import datetime, date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..core import current_profile, require_permission

router = APIRouter(prefix="/api/doctor-sales", tags=["doctor-sales"])

MAX_REPORT_BYTES = 20 * 1024 * 1024
MAX_REPORT_ROWS = 100000

SALE_PREFIX = "مبيعات"
RETURN_WORD = "مردود"
CASH_WORD = "نقد"
CREDIT_WORD = "الآجل"

# V32 KPI weights. Scores are relative to peers inside the same report.
KPI_WEIGHTS = {
    "daily_average": 25.0,
    "invoices_per_active_day": 15.0,
    "average_invoice": 15.0,
    "median_invoice": 10.0,
    "average_items_per_invoice": 10.0,
    "high_value_invoice_percentage": 10.0,
    "stability_score": 10.0,
    "diversity_rate": 5.0,
}


def _peer_score(value: Any, peer_values: list[float]) -> float | None:
    if value is None:
        return None
    try:
        numeric = max(0.0, float(value))
    except (TypeError, ValueError):
        return None
    maximum = max((max(0.0, float(item)) for item in peer_values), default=0.0)
    if maximum <= 0:
        return 0.0
    return round(min(100.0, (numeric / maximum) * 100.0), 1)


def _weighted_kpi(scores: dict[str, float | None], keys: list[str]) -> float | None:
    weighted = 0.0
    used_weight = 0.0
    for key in keys:
        score = scores.get(key)
        if score is None:
            continue
        weight = KPI_WEIGHTS[key]
        weighted += score * weight
        used_weight += weight
    if used_weight <= 0:
        return None
    return round(weighted / used_weight, 1)


def _kpi_label(score: float | None) -> str:
    if score is None:
        return "بيانات غير كافية"
    if score >= 90:
        return "ممتاز"
    if score >= 80:
        return "قوي"
    if score >= 70:
        return "جيد"
    if score >= 60:
        return "متوسط"
    return "يحتاج متابعة"


def _apply_doctor_kpis(result_doctors: list[dict[str, Any]]) -> None:
    if not result_doctors:
        return

    # Diversity is normalized for workload: unique products per 100 cash invoices.
    for doctor in result_doctors:
        invoice_count = int(doctor.get("invoice_count") or 0)
        doctor["diversity_rate"] = round(
            (float(doctor.get("unique_items") or 0) / invoice_count) * 100.0, 2
        ) if invoice_count else 0.0

    metric_peers: dict[str, list[float]] = {}
    for key in KPI_WEIGHTS:
        values: list[float] = []
        for doctor in result_doctors:
            value = doctor.get(key)
            if value is None:
                continue
            try:
                values.append(max(0.0, float(value)))
            except (TypeError, ValueError):
                continue
        metric_peers[key] = values

    productivity_keys = ["daily_average", "invoices_per_active_day"]
    basket_keys = [
        "average_invoice", "median_invoice", "average_items_per_invoice",
        "high_value_invoice_percentage", "diversity_rate",
    ]
    all_keys = list(KPI_WEIGHTS)

    for doctor in result_doctors:
        component_scores = {
            key: _peer_score(doctor.get(key), metric_peers[key])
            for key in KPI_WEIGHTS
        }
        productivity = _weighted_kpi(component_scores, productivity_keys)
        basket_quality = _weighted_kpi(component_scores, basket_keys)
        consistency = component_scores.get("stability_score")
        overall = _weighted_kpi(component_scores, all_keys)

        doctor["kpi_score"] = overall
        doctor["productivity_kpi"] = productivity
        doctor["basket_quality_kpi"] = basket_quality
        doctor["consistency_kpi"] = consistency
        doctor["kpi_components"] = component_scores

    # Make each composite KPI intuitive: the best composite performer in the
    # report anchors the scale at 100, while preserving proportional gaps.
    for field in ("kpi_score", "productivity_kpi", "basket_quality_kpi", "consistency_kpi"):
        available = [
            float(doctor[field]) for doctor in result_doctors
            if doctor.get(field) is not None
        ]
        maximum = max(available, default=0.0)
        if maximum <= 0:
            continue
        for doctor in result_doctors:
            value = doctor.get(field)
            if value is None:
                continue
            doctor[field] = round(min(100.0, (float(value) / maximum) * 100.0), 1)

    for doctor in result_doctors:
        doctor["kpi_label"] = _kpi_label(doctor.get("kpi_score"))


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


def _date_only(value: str) -> str:
    text = _text(value)
    if not text:
        return ""
    return text.split()[0]


def _parse_report_date(value: str) -> date | None:
    text = _date_only(value)
    if not text:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _date_iso(value: date | None) -> str:
    return value.isoformat() if value else ""


def _date_display(value: date | None) -> str:
    return value.strftime("%d/%m/%Y") if value else ""


def _item_identity(item_name: str, item_ref: str) -> str:
    normalized_item = _normalize(item_name)
    return f"ref:{item_ref}" if item_ref and item_ref != "0" else f"name:{normalized_item}"


def analyze_doctor_sales_rows(
    rows: list[list[str]],
    filter_start: str = "",
    filter_end: str = "",
) -> dict[str, Any]:
    report_period_start, report_period_end, source = _period_and_source(rows)
    report_start_date = _parse_report_date(report_period_start)
    report_end_date = _parse_report_date(report_period_end)
    selected_start = _parse_report_date(filter_start) if filter_start else None
    selected_end = _parse_report_date(filter_end) if filter_end else None

    if filter_start and selected_start is None:
        raise HTTPException(422, "تاريخ بداية الفترة غير صالح")
    if filter_end and selected_end is None:
        raise HTTPException(422, "تاريخ نهاية الفترة غير صالح")
    if selected_start and selected_end and selected_start > selected_end:
        raise HTTPException(422, "تاريخ البداية يجب أن يكون قبل أو مساويًا لتاريخ النهاية")
    if report_start_date and selected_start and selected_start < report_start_date:
        raise HTTPException(422, "تاريخ البداية خارج فترة التقرير")
    if report_end_date and selected_end and selected_end > report_end_date:
        raise HTTPException(422, "تاريخ النهاية خارج فترة التقرير")

    period_start = _date_display(selected_start) if selected_start else report_period_start
    period_end = _date_display(selected_end) if selected_end else report_period_end

    doctors: dict[str, dict[str, Any]] = {}
    invoices: dict[tuple[str, str], dict[str, Any]] = {}
    item_stats: dict[tuple[str, str], dict[str, Any]] = {}
    global_items: set[str] = set()
    seen_returns: set[tuple[str, str]] = set()
    excluded_credit_invoices: set[tuple[str, str]] = set()

    processed_rows = 0
    skipped_rows = 0
    excluded_credit_rows = 0

    for row_index, row in enumerate(rows, start=1):
        movement_type = _label_value(row, ": نوع الحركة")
        if not movement_type:
            continue

        if selected_start or selected_end:
            row_date = _parse_report_date(_label_value(row, ": تاريخ الحركة"))
            if row_date is None:
                continue
            if selected_start and row_date < selected_start:
                continue
            if selected_end and row_date > selected_end:
                continue

        is_return = RETURN_WORD in movement_type
        is_sale = movement_type.startswith(SALE_PREFIX) and not is_return
        is_credit = CREDIT_WORD in movement_type
        is_cash = CASH_WORD in movement_type

        # V25: credit sales are completely excluded from doctor-sales analysis.
        if is_sale and is_credit:
            excluded_credit_rows += 1
            doctor = _label_value(row, ": المستخدم")
            movement_number = _label_value(row, ": رقم الحركة")
            if doctor and movement_number:
                excluded_credit_invoices.add((_normalize(doctor), movement_number))
            continue

        is_cash_sale = is_sale and is_cash and not is_credit
        is_cash_return = is_return and is_cash and not is_credit
        if not is_cash_sale and not is_cash_return:
            continue

        doctor = _label_value(row, ": المستخدم")
        movement_number = _label_value(row, ": رقم الحركة")
        movement_date = _label_value(row, ": تاريخ الحركة")
        activity_date = _date_only(movement_date)
        if not doctor or not movement_number:
            skipped_rows += 1
            continue

        doctor_key = _normalize(doctor)
        if not doctor_key:
            skipped_rows += 1
            continue

        invoice_total = abs(_number(_label_value(row, ": الإجمالي")))
        discount = abs(_number(_label_value(row, ": الخصم")))
        invoice_net = max(0.0, invoice_total - discount)

        bucket = doctors.setdefault(doctor_key, {
            "doctor": doctor,
            "sales_total": 0.0,
            "returns_total": 0.0,
            "invoice_count": 0,
            "return_count": 0,
            "unique_items": set(),
            "active_days": set(),
            "sales_lines": 0,
            "boxes_quantity": 0.0,
            "loose_quantity": 0.0,
            "daily_sales": defaultdict(float),
        })
        if len(doctor) > len(bucket["doctor"]):
            bucket["doctor"] = doctor

        if is_cash_return:
            return_key = (doctor_key, movement_number)
            if return_key not in seen_returns:
                seen_returns.add(return_key)
                bucket["returns_total"] += invoice_net
                bucket["return_count"] += 1
            processed_rows += 1
            continue

        invoice_key = (doctor_key, movement_number)
        invoice = invoices.get(invoice_key)
        if invoice is None:
            invoice = {
                "movement_number": movement_number,
                "date": movement_date,
                "activity_date": activity_date,
                "net_total": invoice_net,
                "item_ids": set(),
                "row_order": row_index,
            }
            invoices[invoice_key] = invoice
            bucket["sales_total"] += invoice_net
            bucket["invoice_count"] += 1
            if activity_date:
                bucket["active_days"].add(activity_date)
                bucket["daily_sales"][activity_date] += invoice_net

        item = _item_values(row)
        item_name = _text(item.get("اسم الصنف"))
        item_ref = _text(item.get("ر.ت"))
        quantity = abs(_number(item.get("الكمية")))
        package = _text(item.get("التعبئة"))
        line_total = abs(_number(item.get("الإجمالي")))

        if item_name:
            identity = _item_identity(item_name, item_ref)
            bucket["unique_items"].add(identity)
            global_items.add(identity)
            bucket["sales_lines"] += 1
            invoice["item_ids"].add(identity)

            if package == "علبة":
                bucket["boxes_quantity"] += quantity
            elif package == "فرط":
                bucket["loose_quantity"] += quantity

            stat_key = (doctor_key, identity)
            stat = item_stats.setdefault(stat_key, {
                "identity": identity,
                "item_name": item_name,
                "item_ref": item_ref,
                "invoice_ids": set(),
                "sales_lines": 0,
                "boxes_quantity": 0.0,
                "loose_quantity": 0.0,
                "sales_value": 0.0,
            })
            if len(item_name) > len(stat["item_name"]):
                stat["item_name"] = item_name
            stat["invoice_ids"].add(movement_number)
            stat["sales_lines"] += 1
            stat["sales_value"] += line_total
            if package == "علبة":
                stat["boxes_quantity"] += quantity
            elif package == "فرط":
                stat["loose_quantity"] += quantity

        processed_rows += 1

    if not doctors:
        raise HTTPException(422, "لم نجد مبيعات نقدية مرتبطة بمستخدمين داخل التقرير")

    result_doctors: list[dict[str, Any]] = []
    for doctor_key, bucket in doctors.items():
        invoice_count = int(bucket["invoice_count"])
        sales_total = round(float(bucket["sales_total"]), 3)
        returns_total = round(float(bucket["returns_total"]), 3)
        net_sales = round(sales_total - returns_total, 3)
        active_days_count = len(bucket["active_days"])
        average_invoice = round(sales_total / invoice_count, 3) if invoice_count else 0.0
        daily_average = round(net_sales / active_days_count, 3) if active_days_count else 0.0
        invoices_per_active_day = round(invoice_count / active_days_count, 2) if active_days_count else 0.0

        doctor_invoices: list[dict[str, Any]] = []
        total_invoice_items = 0
        for (key, _movement), invoice in invoices.items():
            if key != doctor_key:
                continue
            item_count = len(invoice["item_ids"])
            total_invoice_items += item_count
            doctor_invoices.append({
                "movement_number": invoice["movement_number"],
                "date": invoice["date"],
                "net_total": round(float(invoice["net_total"]), 3),
                "item_count": item_count,
                "_row_order": invoice["row_order"],
            })
        invoice_values = [float(invoice["net_total"]) for invoice in doctor_invoices]
        median_invoice = round(float(median(invoice_values)), 3) if invoice_values else 0.0
        high_value_invoice_count = sum(1 for value in invoice_values if value > 100)
        high_value_invoice_percentage = round(
            (high_value_invoice_count / invoice_count) * 100, 2
        ) if invoice_count else 0.0

        daily_sales_values = [
            float(bucket["daily_sales"].get(day, 0.0))
            for day in sorted(bucket["active_days"])
        ]
        if len(daily_sales_values) >= 2 and sum(daily_sales_values) > 0:
            mean_daily_sales = sum(daily_sales_values) / len(daily_sales_values)
            daily_cv = pstdev(daily_sales_values) / mean_daily_sales if mean_daily_sales else 0.0
            stability_score = round(100.0 / (1.0 + daily_cv), 1)
            if stability_score >= 85:
                stability_label = "ثابت جدًا"
            elif stability_score >= 70:
                stability_label = "ثابت"
            elif stability_score >= 55:
                stability_label = "متوسط"
            else:
                stability_label = "متذبذب"
        else:
            stability_score = None
            stability_label = "بيانات غير كافية"

        # V26: details page shows only cash invoices above 100 LYD, highest value first.
        doctor_invoices = [invoice for invoice in doctor_invoices if invoice["net_total"] > 100]
        doctor_invoices.sort(
            key=lambda item: (item["net_total"], item["_row_order"]),
            reverse=True,
        )
        for invoice in doctor_invoices:
            invoice.pop("_row_order", None)

        avg_items_per_invoice = round(total_invoice_items / invoice_count, 2) if invoice_count else 0.0

        top_items: list[dict[str, Any]] = []
        for (key, _identity), stat in item_stats.items():
            if key != doctor_key:
                continue
            top_items.append({
                "item_name": stat["item_name"],
                "item_ref": stat["item_ref"],
                "invoice_count": len(stat["invoice_ids"]),
                "sales_lines": int(stat["sales_lines"]),
                "boxes_quantity": round(float(stat["boxes_quantity"]), 2),
                "loose_quantity": round(float(stat["loose_quantity"]), 2),
                "sales_value": round(float(stat["sales_value"]), 3),
            })
        # Frequency across invoices is the safest ranking when the report mixes boxes and loose units.
        top_items.sort(
            key=lambda item: (item["invoice_count"], item["sales_lines"], item["sales_value"]),
            reverse=True,
        )

        result_doctors.append({
            "doctor_key": doctor_key,
            "doctor": bucket["doctor"],
            "sales_total": sales_total,
            "returns_total": returns_total,
            "net_sales": net_sales,
            "invoice_count": invoice_count,
            "return_count": int(bucket["return_count"]),
            "active_days": active_days_count,
            "average_invoice": average_invoice,
            "median_invoice": median_invoice,
            "daily_average": daily_average,
            "invoices_per_active_day": invoices_per_active_day,
            "high_value_invoice_count": high_value_invoice_count,
            "high_value_invoice_percentage": high_value_invoice_percentage,
            "stability_score": stability_score,
            "stability_label": stability_label,
            "unique_items": len(bucket["unique_items"]),
            "average_items_per_invoice": avg_items_per_invoice,
            "sales_lines": int(bucket["sales_lines"]),
            "boxes_quantity": round(float(bucket["boxes_quantity"]), 2),
            "loose_quantity": round(float(bucket["loose_quantity"]), 2),
            "top_items": top_items[:50],
            "invoices": doctor_invoices,
        })

    _apply_doctor_kpis(result_doctors)
    result_doctors.sort(key=lambda item: (item["net_sales"], item["sales_total"]), reverse=True)

    total_sales = round(sum(item["sales_total"] for item in result_doctors), 3)
    total_returns = round(sum(item["returns_total"] for item in result_doctors), 3)
    total_invoices = sum(item["invoice_count"] for item in result_doctors)
    total_active_days = len({
        date
        for bucket in doctors.values()
        for date in bucket["active_days"]
    })
    all_invoice_values = [float(invoice["net_total"]) for invoice in invoices.values()]
    total_median_invoice = round(float(median(all_invoice_values)), 3) if all_invoice_values else 0.0
    total_high_value_invoice_count = sum(1 for value in all_invoice_values if value > 100)
    total_high_value_invoice_percentage = round(
        (total_high_value_invoice_count / total_invoices) * 100, 2
    ) if total_invoices else 0.0
    total_net_sales = round(total_sales - total_returns, 3)
    total_daily_average = round(total_net_sales / total_active_days, 3) if total_active_days else 0.0
    total_invoices_per_active_day = round(total_invoices / total_active_days, 2) if total_active_days else 0.0

    return {
        "source": source,
        "period_start": period_start,
        "period_end": period_end,
        "report_period_start": report_period_start,
        "report_period_end": report_period_end,
        "available_start_iso": _date_iso(report_start_date),
        "available_end_iso": _date_iso(report_end_date),
        "filter_start_iso": _date_iso(selected_start),
        "filter_end_iso": _date_iso(selected_end),
        "is_filtered": bool(selected_start or selected_end),
        "sales_scope": "cash_only",
        "doctor_count": len(result_doctors),
        "processed_rows": processed_rows,
        "skipped_rows": skipped_rows,
        "excluded_credit_rows": excluded_credit_rows,
        "excluded_credit_invoice_count": len(excluded_credit_invoices),
        "totals": {
            "sales_total": total_sales,
            "returns_total": total_returns,
            "net_sales": total_net_sales,
            "invoice_count": total_invoices,
            "average_invoice": round(total_sales / total_invoices, 3) if total_invoices else 0.0,
            "median_invoice": total_median_invoice,
            "daily_average": total_daily_average,
            "invoices_per_active_day": total_invoices_per_active_day,
            "high_value_invoice_count": total_high_value_invoice_count,
            "high_value_invoice_percentage": total_high_value_invoice_percentage,
            "unique_items": len(global_items),
            "active_days": total_active_days,
            "kpi_average": round(
                sum(float(item["kpi_score"]) for item in result_doctors if item.get("kpi_score") is not None)
                / max(1, sum(1 for item in result_doctors if item.get("kpi_score") is not None)),
                1,
            ),
        },
        "kpi_method": {
            "basis": "peer_relative",
            "weights": KPI_WEIGHTS,
            "note": "KPI نسبي داخل نفس التقرير؛ كل مؤشر يقاس مقارنة بأفضل أداء داخل الفريق.",
        },
        "doctors": result_doctors,
    }


@router.post("/analyze")
async def analyze_doctor_sales(
    file: UploadFile = File(...),
    date_from: str = Form(""),
    date_to: str = Form(""),
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

    return analyze_doctor_sales_rows(rows, date_from, date_to)
