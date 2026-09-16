from __future__ import annotations

import os
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from ..core import *

router = APIRouter()

LOGIN_FAILURE_WINDOW_SECONDS = max(60, int(os.getenv("LOGIN_FAILURE_WINDOW_SECONDS", "600")))
LOGIN_MAX_FAILURES = max(3, int(os.getenv("LOGIN_MAX_FAILURES", "8")))
LOGIN_FAILURES: dict[str, list[float]] = {}
SHOW_LOGIN_ACCOUNTS = os.getenv("SHOW_LOGIN_ACCOUNTS", "false").strip().lower() in {"1", "true", "yes", "on"}


def _login_key(request: Request, username: str) -> str:
    client = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    if forwarded:
        client = forwarded[:80]
    return f"{client}|{username[:40]}"


def _check_login_limit(key: str) -> None:
    now = time.time()
    recent = [x for x in LOGIN_FAILURES.get(key, []) if now - x < LOGIN_FAILURE_WINDOW_SECONDS]
    if recent:
        LOGIN_FAILURES[key] = recent
    else:
        LOGIN_FAILURES.pop(key, None)
    if len(recent) >= LOGIN_MAX_FAILURES:
        retry_seconds = max(1, int(LOGIN_FAILURE_WINDOW_SECONDS - (now - recent[0])))
        raise HTTPException(429, f"محاولات دخول كثيرة. حاول مرة أخرى بعد {retry_seconds // 60 + 1} دقيقة")


def _record_login_failure(key: str) -> None:
    now = time.time()
    recent = [x for x in LOGIN_FAILURES.get(key, []) if now - x < LOGIN_FAILURE_WINDOW_SECONDS]
    recent.append(now)
    LOGIN_FAILURES[key] = recent[-LOGIN_MAX_FAILURES:]


@router.get("/")
async def home() -> FileResponse:
    return FileResponse(FRONTEND / "index.html")


@router.get("/sw.js", include_in_schema=False)
async def service_worker() -> FileResponse:
    response = FileResponse(FRONTEND / "sw.js", media_type="application/javascript")
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@router.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "service": "abdo-debts", "version": APP_VERSION, "admin_api": bool(SUPABASE_SERVICE_ROLE_KEY)}


@router.get("/api/auth/accounts")
async def login_accounts() -> Any:
    # Account discovery is disabled by default so the public login page does not
    # disclose active usernames. Set SHOW_LOGIN_ACCOUNTS=true only on a trusted
    # private deployment if the account picker is desired.
    if not SHOW_LOGIN_ACCOUNTS:
        return []
    require_service_key()
    now = time.time()
    if LOGIN_CACHE.get("rows") is not None and LOGIN_CACHE.get("expires", 0) > now:
        return LOGIN_CACHE["rows"]
    rows = await sb("GET", "/rest/v1/profiles", service=True, params={
        "select": "username,full_name", "active": "eq.true", "username": "not.is.null", "order": "username.asc"
    })
    result = [{"username": x.get("username"), "full_name": x.get("full_name")} for x in rows or []]
    LOGIN_CACHE["rows"] = result
    LOGIN_CACHE["expires"] = now + LOGIN_CACHE_TTL
    return result


@router.post("/api/auth/login")
async def login(data: LoginInput, request: Request) -> Any:
    require_service_key()
    username = data.username.strip().lower()
    key = _login_key(request, username)
    _check_login_limit(key)
    profiles = await sb("GET", "/rest/v1/profiles", service=True, params={
        "select": "id,username,full_name,role,active,permissions,all_branches,profile_branches(branch_id)",
        "username": f"eq.{username}", "limit": "1"
    })
    if not profiles or not profiles[0].get("active", True):
        _record_login_failure(key)
        raise HTTPException(401, "اسم المستخدم أو كلمة المرور غير صحيحة")
    try:
        auth_user = await sb("GET", f"/auth/v1/admin/users/{profiles[0]['id']}", service=True)
    except HTTPException as exc:
        _record_login_failure(key)
        if exc.status_code in (400, 401, 403, 404):
            raise HTTPException(401, "اسم المستخدم أو كلمة المرور غير صحيحة") from exc
        raise
    email = auth_user.get("email")
    if not email:
        _record_login_failure(key)
        raise HTTPException(401, "اسم المستخدم أو كلمة المرور غير صحيحة")
    try:
        result = await sb("POST", "/auth/v1/token?grant_type=password", json={"email": email, "password": data.password})
    except HTTPException as exc:
        if exc.status_code in (400, 401):
            _record_login_failure(key)
            raise HTTPException(401, "اسم المستخدم أو كلمة المرور غير صحيحة") from exc
        raise
    LOGIN_FAILURES.pop(key, None)
    profile = normalize_profile(profiles[0])
    access_token = result.get("access_token")
    if access_token:
        PROFILE_CACHE[access_token] = (dict(profile), time.time() + PROFILE_CACHE_TTL)
    result["profile"] = profile
    return result


@router.post("/api/auth/logout")
async def logout_session(token: str = Depends(bearer)) -> Any:
    # Revoke the Supabase session/refresh token, then forget any cached profile.
    try:
        await sb("POST", "/auth/v1/logout", token)
    finally:
        PROFILE_CACHE.pop(token, None)
    return {"ok": True}


@router.post("/api/auth/refresh")
async def refresh(data: RefreshInput) -> Any:
    try:
        return await sb("POST", "/auth/v1/token?grant_type=refresh_token", json={"refresh_token": data.refresh_token})
    except HTTPException as exc:
        if exc.status_code in (400, 401):
            raise HTTPException(401, "انتهت صلاحية الجلسة؛ سجل الدخول من جديد") from exc
        raise


@router.get("/api/me")
async def me(profile: dict[str, Any] = Depends(current_profile)) -> Any:
    return profile
