"""Offline V85 smoke tests.

Uses the project's local backend/.env only to allow normal module import; it does
not make Supabase/network requests.
"""
from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.core import APP_VERSION  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.routers.admin import _can_manage_target  # noqa: E402
from backend.app.routers.suppliers import _supplier_financial_maps, _supplier_signed_totals  # noqa: E402


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    check(APP_VERSION == "85.0.0", "APP_VERSION is not V85")

    cases = [
        ([{"supplier_id": "s", "branch_id": "b", "balance": 60, "invoice_date": "2026-09-01"}], [{"supplier_id": "s", "branch_id": "b", "signed_balance": -100}], -60.0),
        ([{"supplier_id": "s", "branch_id": "b", "balance": 30, "invoice_date": "2026-09-01"}], [{"supplier_id": "s", "branch_id": "b", "signed_balance": 100}], 70.0),
        ([{"supplier_id": "s", "branch_id": "b", "balance": 30, "invoice_date": "2026-09-01"}], [], -30.0),
        ([], [{"supplier_id": "s", "branch_id": "b", "signed_balance": -100}], -100.0),
    ]
    for invoices, external, expected in cases:
        value = _supplier_financial_maps(invoices, external)["signed_by_pair"][("s", "b")]
        check(value == expected, f"supplier signed balance mismatch: {value} != {expected}")

    multi = _supplier_financial_maps(
        [
            {"supplier_id": "s", "branch_id": "b1", "balance": 20, "invoice_date": "2026-09-01"},
            {"supplier_id": "s", "branch_id": "b2", "balance": 30, "invoice_date": "2026-09-02"},
        ],
        [],
    )
    check(_supplier_signed_totals(multi)["s"] == -50.0, "multi-branch supplier total failed")

    manager = {"id": "m", "role": "finance", "all_branches": False, "branch_ids": ["b1"], "permissions": {"manage_users": True}}
    normal = {"id": "u", "role": "finance", "all_branches": False, "branch_ids": ["b1"], "permissions": {}}
    outside = {"id": "o", "role": "finance", "all_branches": False, "branch_ids": ["b2"], "permissions": {}}
    check(_can_manage_target(manager, normal), "delegated manager should manage same-scope normal user")
    check(not _can_manage_target(manager, outside), "delegated manager escaped branch scope")
    check(not _can_manage_target(manager, manager, allow_self=True), "delegated manager can edit own privileged profile")

    paths = {getattr(route, "path", "") for route in app.routes}
    check("/health" in paths, "health route missing")
    check("/api/tasks/employees/report" in paths, "employee PDF report data route missing")

    index = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
    sw = (ROOT / "frontend" / "sw.js").read_text(encoding="utf-8")
    check("?v=85" in index, "frontend cache version not V85")
    check("abdo-debts-v85" in sw, "service worker cache version not V85")
    for marker in ("<<<<<<<", "=======", ">>>>>>>"):
        check(marker not in index, f"merge marker left in index.html: {marker}")

    print("V85 smoke tests: OK")


if __name__ == "__main__":
    main()
