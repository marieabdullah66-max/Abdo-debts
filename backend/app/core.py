from __future__ import annotations

import os
import time
from datetime import date
from pathlib import Path
from typing import Any, Literal

import httpx
from dotenv import load_dotenv
from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel, Field, model_validator

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / "backend" / ".env"
load_dotenv(ENV_FILE)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
SUPABASE_SERVICE_ROLE_KEY = (os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")).strip()
FRONTEND = ROOT / "frontend"

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required in backend/.env")

HTTP_CLIENT: httpx.AsyncClient | None = None
PROFILE_CACHE_TTL = int(os.getenv("PROFILE_CACHE_TTL", "45"))
PROFILE_CACHE: dict[str, tuple[dict[str, Any], float]] = {}
LOGIN_CACHE_TTL = int(os.getenv("LOGIN_CACHE_TTL", "120"))
LOGIN_CACHE: dict[str, Any] = {"rows": None, "expires": 0.0}

PERMISSION_KEYS = {
    "view_dashboard",
    "view_suppliers", "manage_suppliers",
    "view_invoices", "create_invoices", "edit_invoices", "delete_invoices",
    "view_payments", "create_payments", "edit_payments", "delete_payments",
    "manage_branches", "manage_users", "view_reports",
    "view_item_analysis", "manage_item_catalog",
    "view_payment_plans", "manage_payment_plans",
}

ROLE_DEFAULT_PERMISSIONS: dict[str, dict[str, bool]] = {
    "admin": {key: True for key in PERMISSION_KEYS},
    "finance": {
        "view_dashboard": True,
        "view_suppliers": True,
        "manage_suppliers": True,
        "view_invoices": True,
        "create_invoices": True,
        "edit_invoices": True,
        "view_payments": True,
        "create_payments": True,
        "edit_payments": True,
        "view_reports": True,
        "view_item_analysis": True,
        "manage_item_catalog": True,
        "view_payment_plans": True,
        "manage_payment_plans": True,
    },
    "viewer": {
        "view_dashboard": True,
        "view_suppliers": True,
        "view_invoices": True,
        "view_payments": True,
        "view_reports": True,
        "view_item_analysis": True,
        "view_payment_plans": True,
    },
}


def get_http_client() -> httpx.AsyncClient:
    global HTTP_CLIENT
    if HTTP_CLIENT is None or HTTP_CLIENT.is_closed:
        HTTP_CLIENT = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=8.0),
            limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
        )
    return HTTP_CLIENT


async def close_http_client() -> None:
    global HTTP_CLIENT
    if HTTP_CLIENT and not HTTP_CLIENT.is_closed:
        await HTTP_CLIENT.aclose()
    HTTP_CLIENT = None


def api_headers(token: str | None = None, *, service: bool = False, content_type: str = "application/json") -> dict[str, str]:
    key = SUPABASE_SERVICE_ROLE_KEY if service and SUPABASE_SERVICE_ROLE_KEY else SUPABASE_KEY
    headers = {"apikey": key}
    if content_type:
        headers["Content-Type"] = content_type
    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif service and SUPABASE_SERVICE_ROLE_KEY:
        headers["Authorization"] = f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
    return headers


def require_service_key() -> None:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(503, "أضف SUPABASE_SECRET_KEY لتفعيل العمليات الإدارية")


async def sb(method: str, path: str, token: str | None = None, *, service: bool = False, **kwargs: Any) -> Any:
    custom_headers = kwargs.pop("headers", None)
    headers = api_headers(token, service=service)
    if custom_headers:
        headers.update(custom_headers)
    response = await get_http_client().request(method, f"{SUPABASE_URL}{path}", headers=headers, **kwargs)
    if response.status_code >= 400:
        detail: Any = response.text
        try:
            payload = response.json()
            detail = payload.get("message") or payload.get("error_description") or payload.get("msg") or detail
        except Exception:
            pass
        raise HTTPException(response.status_code, detail)
    if not response.content:
        return None
    ctype = response.headers.get("content-type", "")
    return response.json() if "json" in ctype else response.content




def is_expired_jwt_error(exc: HTTPException) -> bool:
    text = str(exc.detail or "").lower()
    return exc.status_code in (401, 403) and any(marker in text for marker in (
        "invalid jwt",
        "token is expired",
        "token expired",
        "invalid claims",
        "unable to parse or verify signature",
        "jwt expired",
    ))

def bearer(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "يلزم تسجيل الدخول")
    return authorization.split(" ", 1)[1].strip()


def effective_permissions(profile: dict[str, Any]) -> dict[str, bool]:
    result = {key: False for key in PERMISSION_KEYS}
    result.update(ROLE_DEFAULT_PERMISSIONS.get(profile.get("role"), {}))
    custom = profile.get("permissions") or {}
    if isinstance(custom, dict):
        for key, value in custom.items():
            if key in PERMISSION_KEYS and isinstance(value, bool):
                result[key] = value
    return result


def normalize_profile(profile: dict[str, Any]) -> dict[str, Any]:
    branch_links = profile.pop("profile_branches", None) or []
    profile["branch_ids"] = [x.get("branch_id") for x in branch_links if x.get("branch_id")]
    profile["effective_permissions"] = effective_permissions(profile)
    return profile


async def profile_for_token(token: str) -> dict[str, Any]:
    now = time.time()
    cached = PROFILE_CACHE.get(token)
    if cached and cached[1] > now:
        return dict(cached[0])

    try:
        user = await sb("GET", "/auth/v1/user", token)
    except HTTPException as exc:
        if is_expired_jwt_error(exc):
            raise HTTPException(401, "انتهت صلاحية الجلسة") from exc
        raise
    uid = user.get("id")
    if not uid:
        raise HTTPException(401, "جلسة الدخول غير صالحة")
    rows = await sb(
        "GET", "/rest/v1/profiles",
        service=bool(SUPABASE_SERVICE_ROLE_KEY), token=None if SUPABASE_SERVICE_ROLE_KEY else token,
        params={
            "select": "id,username,full_name,role,active,permissions,all_branches,profile_branches(branch_id)",
            "id": f"eq.{uid}", "limit": "1",
        },
    )
    if not rows:
        raise HTTPException(403, "الحساب لا يملك ملف مستخدم")
    profile = normalize_profile(rows[0])
    if not profile.get("active", True):
        raise HTTPException(403, "الحساب موقوف")
    PROFILE_CACHE[token] = (dict(profile), now + PROFILE_CACHE_TTL)
    return profile


async def current_profile(token: str = Depends(bearer)) -> dict[str, Any]:
    return await profile_for_token(token)


def clear_profile_cache(user_id: str | None = None) -> None:
    if user_id is None:
        PROFILE_CACHE.clear()
        return
    for key, (profile, _) in list(PROFILE_CACHE.items()):
        if profile.get("id") == user_id:
            PROFILE_CACHE.pop(key, None)


def clear_login_cache() -> None:
    LOGIN_CACHE["rows"] = None
    LOGIN_CACHE["expires"] = 0.0


def require_permission(profile: dict[str, Any], permission: str) -> None:
    if not effective_permissions(profile).get(permission, False):
        raise HTTPException(403, "ليس لديك صلاحية تنفيذ هذا الإجراء")


def branch_ids_for(profile: dict[str, Any]) -> set[str] | None:
    if profile.get("all_branches"):
        return None
    return set(profile.get("branch_ids") or [])


def require_branch_access(profile: dict[str, Any], branch_id: str) -> None:
    allowed = branch_ids_for(profile)
    if allowed is not None and branch_id not in allowed:
        raise HTTPException(403, "ليس لديك صلاحية على هذا الفرع")


def apply_branch_filter(params: dict[str, str], profile: dict[str, Any], field: str = "branch_id") -> dict[str, str]:
    allowed = branch_ids_for(profile)
    if allowed is None:
        return params
    if not allowed:
        params[field] = "eq.00000000-0000-0000-0000-000000000000"
    elif len(allowed) == 1:
        params[field] = f"eq.{next(iter(allowed))}"
    else:
        params[field] = f"in.({','.join(sorted(allowed))})"
    return params


# -------- Pydantic inputs --------
class LoginInput(BaseModel):
    username: str = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9._-]+$")
    password: str = Field(min_length=1, max_length=100)


class RefreshInput(BaseModel):
    refresh_token: str = Field(min_length=10, max_length=4096)


class BranchInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class BranchUpdateInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    active: bool = True


class ItemInput(BaseModel):
    item_code: str = Field(min_length=1, max_length=160)
    item_name: str = Field(min_length=1, max_length=240)
    package_form: str | None = Field(default=None, max_length=120)
    units_per_box: int = Field(gt=0, le=100000)


class SupplierInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    phone: str | None = Field(default=None, max_length=50)
    notes: str | None = Field(default=None, max_length=1000)
    category_ids: list[str] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def normalize_categories(self):
        self.category_ids = list(dict.fromkeys(x.strip() for x in self.category_ids if x and x.strip()))
        return self


class SupplierCategoryInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)


class InvoiceInput(BaseModel):
    supplier_id: str
    branch_id: str
    invoice_number: str = Field(min_length=1, max_length=100)
    amount: float = Field(gt=0, le=999999999999)
    invoice_date: date
    due_date: date | None = None
    notes: str | None = Field(default=None, max_length=1500)


class InvoiceUpdateInput(InvoiceInput):
    pass


class PaymentAllocationInput(BaseModel):
    invoice_id: str
    amount: float = Field(gt=0, le=999999999999)


class PaymentPlanInput(BaseModel):
    supplier_id: str
    branch_id: str
    planned_amount: float = Field(gt=0, le=999999999999)
    planned_date: date
    notes: str | None = Field(default=None, max_length=1500)


class PaymentPlanPostponeInput(BaseModel):
    planned_date: date
    reason: str = Field(min_length=2, max_length=1000)


class PaymentPlanCompleteInput(BaseModel):
    payment_id: str | None = None


class PaymentInput(BaseModel):
    supplier_id: str
    branch_id: str
    amount: float = Field(gt=0, le=999999999999)
    payment_date: date
    method: Literal["cash", "bank"]
    bank_name: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=1500)
    allocations: list[PaymentAllocationInput] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_payment(self):
        if self.method == "bank" and not (self.bank_name or "").strip():
            raise ValueError("اسم المصرف مطلوب للسداد المصرفي")
        if self.method == "cash":
            self.bank_name = None
        total = round(sum(x.amount for x in self.allocations), 2)
        if round(self.amount, 2) != total:
            raise ValueError("مجموع توزيع السداد يجب أن يساوي قيمة السداد")
        ids = [x.invoice_id for x in self.allocations]
        if len(ids) != len(set(ids)):
            raise ValueError("لا يمكن تكرار نفس الفاتورة في توزيع واحد")
        return self


class UserCreateInput(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9._-]+$")
    password: str = Field(min_length=6, max_length=100)
    role: Literal["admin", "finance", "viewer"] = "finance"
    all_branches: bool = False
    branch_ids: list[str] = Field(default_factory=list, max_length=100)
    permissions: dict[str, bool] = Field(default_factory=dict)


class UserUpdateInput(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    username: str = Field(min_length=3, max_length=30, pattern=r"^[A-Za-z0-9._-]+$")
    password: str | None = Field(default=None, min_length=6, max_length=100)
    role: Literal["admin", "finance", "viewer"]
    active: bool = True
    all_branches: bool = False
    branch_ids: list[str] = Field(default_factory=list, max_length=100)
    permissions: dict[str, bool] = Field(default_factory=dict)
