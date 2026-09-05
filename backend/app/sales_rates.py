from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any
import unicodedata

from .core import apply_branch_filter, require_branch_access, sb


def _as_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _date_set(start: date, end: date) -> set[date]:
    return {start + timedelta(days=i) for i in range((end - start).days + 1)}


def _normalize_name(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).casefold().strip()
    return " ".join(text.split())


async def _all_aliases() -> dict[str, str]:
    rows: list[dict[str, Any]] = []
    for offset in range(0, 50000, 1000):
        page = await sb(
            "GET",
            "/rest/v1/item_name_aliases",
            service=True,
            params={"select": "report_name_norm,item_id", "order": "created_at.asc"},
            headers={"Range": f"{offset}-{offset + 999}"},
        )
        rows.extend(page or [])
        if len(page or []) < 1000:
            break
    return {str(row.get("report_name_norm") or ""): str(row.get("item_id") or "") for row in rows}


async def _all_catalog() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for offset in range(0, 50000, 1000):
        page = await sb(
            "GET",
            "/rest/v1/item_catalog",
            service=True,
            params={
                "select": "id,item_code,item_name,package_form,units_per_box",
                "order": "item_name.asc",
            },
            headers={"Range": f"{offset}-{offset + 999}"},
        )
        rows.extend(page or [])
        if len(page or []) < 1000:
            break
    return rows


async def _all_reports(profile: dict[str, Any], branch_id: str | None = None) -> list[dict[str, Any]]:
    params: dict[str, str] = {
        "select": "id,branch_id,period_start,period_end,days_count,created_at,branches(name)",
        "order": "created_at.desc,period_end.desc",
    }
    params = apply_branch_filter(params, profile)
    if branch_id:
        require_branch_access(profile, branch_id)
        params["branch_id"] = f"eq.{branch_id}"

    rows: list[dict[str, Any]] = []
    for offset in range(0, 5000, 1000):
        page = await sb(
            "GET",
            "/rest/v1/item_movement_reports",
            service=True,
            params=params,
            headers={"Range": f"{offset}-{offset + 999}"},
        )
        rows.extend(page or [])
        if len(page or []) < 1000:
            break
    return rows


async def _movement_rows(report_ids: list[str]) -> list[dict[str, Any]]:
    if not report_ids:
        return []
    rows: list[dict[str, Any]] = []
    # Keep the PostgREST URL comfortably small even with many saved reports.
    for batch_start in range(0, len(report_ids), 35):
        batch_ids = report_ids[batch_start : batch_start + 35]
        id_filter = f"in.({','.join(batch_ids)})"
        for offset in range(0, 200000, 1000):
            page = await sb(
                "GET",
                "/rest/v1/item_movement_rows",
                service=True,
                params={
                    "select": "report_id,item_id,report_name,report_name_norm,boxes_sold,loose_sold",
                    "report_id": id_filter,
                },
                headers={"Range": f"{offset}-{offset + 999}"},
            )
            rows.extend(page or [])
            if len(page or []) < 1000:
                break
    return rows


def _effective_report_plan(reports: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Create a non-double-counting plan for saved report periods.

    Exact same branch+period uploads are already replaced by the importer. For
    partially overlapping saved periods, the most recently saved report owns the
    overlapping days. Older aggregate totals are prorated to their still-unique
    days. This is the safest possible adjustment when only period totals (not
    daily item rows) are available.
    """
    by_branch: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for report in reports:
        by_branch[str(report.get("branch_id") or "")].append(report)

    plan: dict[str, dict[str, Any]] = {}
    branch_meta: dict[str, dict[str, Any]] = {}
    for branch_key, branch_reports in by_branch.items():
        covered: set[date] = set()
        branch_name = ""
        used_reports = 0
        overlap_reports = 0
        raw_reports = len(branch_reports)

        # API already orders newest first, but keep this deterministic if tests
        # or a future backend return a different order.
        branch_reports = sorted(
            branch_reports,
            key=lambda r: (str(r.get("created_at") or ""), str(r.get("period_end") or "")),
            reverse=True,
        )
        for report in branch_reports:
            if not branch_name:
                branch_name = str((report.get("branches") or {}).get("name") or "")
            start = _as_date(report.get("period_start"))
            end = _as_date(report.get("period_end"))
            if not start or not end or end < start:
                plan[str(report.get("id") or "")] = {"weight": 0.0, "effective_days": 0, "start": start, "end": end}
                continue
            all_days = _date_set(start, end)
            unique_days = all_days - covered
            effective_days = len(unique_days)
            actual_days = max(1, len(all_days))
            weight = effective_days / actual_days
            if weight > 0:
                used_reports += 1
            if weight < 0.999999:
                overlap_reports += 1
            plan[str(report.get("id") or "")] = {
                "weight": weight,
                "effective_days": effective_days,
                "start": start,
                "end": end,
                "branch_id": branch_key,
            }
            covered.update(all_days)

        branch_meta[branch_key] = {
            "branch_id": branch_key,
            "branch_name": branch_name,
            "coverage_days": len(covered),
            "period_start": min(covered).isoformat() if covered else None,
            "period_end": max(covered).isoformat() if covered else None,
            "report_count": raw_reports,
            "effective_report_count": used_reports,
            "overlap_report_count": overlap_reports,
        }
    return plan, branch_meta


async def aggregate_item_sales_rates(
    profile: dict[str, Any],
    branch_id: str | None = None,
) -> dict[str, Any]:
    """Calculate the catalog's trusted daily sales rate from all saved reports.

    For one branch, rate = adjusted equivalent boxes / unique covered days.
    For all branches, each branch is calculated independently then branch daily
    rates are summed, which represents total daily demand across the pharmacy
    network instead of incorrectly averaging branch-days together.
    """
    catalog = await _all_catalog()
    aliases = await _all_aliases()
    reports = await _all_reports(profile, branch_id)
    report_plan, branch_meta = _effective_report_plan(reports)

    catalog_by_id = {str(item.get("id")): item for item in catalog}
    catalog_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in catalog:
        normalized = _normalize_name(item.get("item_name"))
        if normalized:
            catalog_by_name[normalized].append(item)
    effective_ids = [rid for rid, info in report_plan.items() if float(info.get("weight") or 0) > 0]
    movement_rows = await _movement_rows(effective_ids)

    branch_item_equivalent: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    item_reports: dict[str, set[str]] = defaultdict(set)
    item_last_date: dict[str, date] = {}
    skipped_rows = 0

    report_lookup = {str(report.get("id") or ""): report for report in reports}
    for row in movement_rows:
        report_id = str(row.get("report_id") or "")
        item_id = str(row.get("item_id") or "")
        item = catalog_by_id.get(item_id)
        if not item:
            normalized = str(row.get("report_name_norm") or "").strip() or _normalize_name(row.get("report_name"))
            exact = catalog_by_name.get(normalized) or []
            if len(exact) == 1:
                item = exact[0]
                item_id = str(item.get("id") or "")
            else:
                alias_item_id = aliases.get(normalized)
                if alias_item_id:
                    item = catalog_by_id.get(alias_item_id)
                    item_id = alias_item_id if item else ""
        info = report_plan.get(report_id)
        report = report_lookup.get(report_id)
        if not item or not item_id or not info or not report:
            skipped_rows += 1
            continue
        weight = float(info.get("weight") or 0)
        if weight <= 0:
            continue
        try:
            units = int(item.get("units_per_box") or 0)
            boxes = float(row.get("boxes_sold") or 0)
            loose = float(row.get("loose_sold") or 0)
        except (TypeError, ValueError):
            skipped_rows += 1
            continue
        if units <= 0:
            skipped_rows += 1
            continue
        equivalent = max(0.0, boxes) + max(0.0, loose) / units
        adjusted = equivalent * weight
        branch_key = str(report.get("branch_id") or "")
        branch_item_equivalent[branch_key][item_id] += adjusted
        if equivalent > 0:
            item_reports[item_id].add(report_id)
            end = _as_date(report.get("period_end"))
            if end and (item_id not in item_last_date or end > item_last_date[item_id]):
                item_last_date[item_id] = end

    rate_rows: list[dict[str, Any]] = []
    for item_id, item in catalog_by_id.items():
        daily_rate = 0.0
        total_equivalent = 0.0
        active_branches = 0
        for branch_key, meta in branch_meta.items():
            coverage_days = int(meta.get("coverage_days") or 0)
            equivalent = float(branch_item_equivalent.get(branch_key, {}).get(item_id, 0.0))
            total_equivalent += equivalent
            if coverage_days > 0:
                branch_rate = equivalent / coverage_days
                daily_rate += branch_rate
                if equivalent > 0:
                    active_branches += 1
        if daily_rate <= 0 and total_equivalent <= 0:
            continue
        rate_rows.append({
            "item_id": item_id,
            "item_code": str(item.get("item_code") or ""),
            "item_name": str(item.get("item_name") or ""),
            "package_form": item.get("package_form"),
            "units_per_box": item.get("units_per_box"),
            "daily_rate": round(daily_rate, 6),
            "total_equivalent_boxes": round(total_equivalent, 6),
            "report_count": len(item_reports.get(item_id, set())),
            "active_branch_count": active_branches,
            "last_movement_date": item_last_date[item_id].isoformat() if item_id in item_last_date else None,
        })

    rate_rows.sort(key=lambda row: (-float(row.get("daily_rate") or 0), str(row.get("item_name") or "")))

    all_covered_days: set[date] = set()
    for meta in branch_meta.values():
        start = _as_date(meta.get("period_start"))
        end = _as_date(meta.get("period_end"))
        if start and end:
            all_covered_days.update(_date_set(start, end))

    selected_branch_name = None
    if branch_id:
        selected_branch_name = str((branch_meta.get(branch_id) or {}).get("branch_name") or "") or None

    meta = {
        "branch_id": branch_id,
        "branch_name": selected_branch_name,
        "scope": "branch" if branch_id else "all_branches",
        "catalog_item_count": len(catalog),
        "items_with_rate": len(rate_rows),
        "report_count": len(reports),
        "effective_report_count": sum(int(x.get("effective_report_count") or 0) for x in branch_meta.values()),
        "overlap_report_count": sum(int(x.get("overlap_report_count") or 0) for x in branch_meta.values()),
        "branch_count": len(branch_meta),
        "coverage_days": int((branch_meta.get(branch_id) or {}).get("coverage_days") or 0) if branch_id else len(all_covered_days),
        "branch_day_count": sum(int(x.get("coverage_days") or 0) for x in branch_meta.values()),
        "period_start": min(all_covered_days).isoformat() if all_covered_days else None,
        "period_end": max(all_covered_days).isoformat() if all_covered_days else None,
        "skipped_rows": skipped_rows,
        "branches": list(branch_meta.values()),
    }
    return {"meta": meta, "rows": rate_rows}
