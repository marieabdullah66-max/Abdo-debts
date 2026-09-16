"""Offline V86 smoke tests. No network calls are made."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_PUBLISHABLE_KEY", "test-publishable")
os.environ.setdefault("SUPABASE_SECRET_KEY", "test-secret")

import backend.app.core as core  # noqa: E402
from backend.app.core import APP_VERSION, EmployeeInput, branch_ids_for  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.routers.tasks import _employee_accessible  # noqa: E402
from backend.app.routers.suppliers import _supplier_financial_maps, _supplier_signed_totals  # noqa: E402


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


async def _paging_check() -> None:
    original = core.sb
    async def fake_sb(method, path, token=None, *, service=False, **kwargs):
        raw = (kwargs.get("headers") or {}).get("Range", "0-999")
        start, end = [int(x) for x in raw.split("-")]
        total = 2505
        if start >= total:
            return []
        return [{"n": i} for i in range(start, min(end + 1, total))]
    core.sb = fake_sb
    try:
        rows = await core.sb_paged("/rest/v1/test", service=True, page_size=1000, max_rows=10000)
        check(len(rows) == 2505 and rows[-1]["n"] == 2504, "paged PostgREST read truncated")
    finally:
        core.sb = original


def main() -> None:
    check(APP_VERSION == "86.0.0", "APP_VERSION is not V86")
    import asyncio
    asyncio.run(_paging_check())

    financial = _supplier_financial_maps(
        [{"supplier_id":"s","branch_id":"b1","balance":20,"invoice_date":"2026-09-01"}, {"supplier_id":"s","branch_id":"b2","balance":30,"invoice_date":"2026-09-02"}],
        [],
    )
    check(_supplier_signed_totals(financial)["s"] == -50.0, "V85 supplier balance repair regressed")
    check(EmployeeInput(name="Ahmed", base_salary=1000, branch_id="b1").branch_id == "b1", "employee branch input missing")

    one_branch = {"id": "u1", "all_branches": False, "branch_ids": ["b1"]}
    multi_branch = {"id": "u2", "all_branches": False, "branch_ids": ["b1", "b2"]}
    all_branches = {"id": "admin", "all_branches": True, "branch_ids": []}
    check(branch_ids_for(all_branches) is None, "all-branches scope broken")
    check(_employee_accessible({"user_id": "other", "branch_id": "b1"}, one_branch), "same-branch employee should be visible")
    check(not _employee_accessible({"user_id": "other", "branch_id": "b2"}, one_branch), "outside-branch employee leaked")
    check(_employee_accessible({"user_id": "u2", "branch_id": None}, multi_branch), "legacy own employee should remain visible")
    check(not _employee_accessible({"user_id": "other", "branch_id": None}, multi_branch), "legacy private employee leaked")
    check(_employee_accessible({"user_id": "other", "branch_id": "b9"}, all_branches), "admin all-branch employee visibility broken")

    paths = {getattr(route, "path", "") for route in app.routes}
    for path in ("/health", "/api/tasks/employees", "/api/tasks/employees/report", "/api/tasks/employees/{employee_id}/records"):
        check(path in paths, f"route missing: {path}")

    index = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    sw = (ROOT / "frontend" / "sw.js").read_text(encoding="utf-8")
    app_js = (ROOT / "frontend" / "app.js").read_text(encoding="utf-8")
    migration = (ROOT / "supabase" / "migrations" / "V86_employee_branch_performance.sql").read_text(encoding="utf-8")
    check("?v=86" in index, "frontend cache version not V86")
    check("abdo-debts-v86" in sw, "service worker cache version not V86")
    check("employeesBranchFilter" in app_js, "employee branch filter missing")
    check("branch_id" in migration and "employee_records_employee_fk" in migration, "V86 employee migration incomplete")
    for marker in ("<<<<<<<", "=======", ">>>>>>>"):
        check(marker not in index and marker not in app_js, f"merge marker left in frontend: {marker}")

    print("V86 smoke tests: OK")


if __name__ == "__main__":
    main()
