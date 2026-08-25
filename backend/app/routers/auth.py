from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from ..core import *

router = APIRouter()

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
    return {"status": "ok", "service": "abdo-debts", "version": "1.0.0", "admin_api": bool(SUPABASE_SERVICE_ROLE_KEY)}

@router.get("/api/auth/accounts")
async def login_accounts() -> Any:
    require_service_key()
    now = time.time()
    if LOGIN_CACHE.get("rows") is not None and LOGIN_CACHE.get("expires", 0) > now:
        return LOGIN_CACHE["rows"]
    rows = await sb("GET", "/rest/v1/profiles", service=True, params={
        "select": "username,full_name,role", "active": "eq.true", "username": "not.is.null", "order": "username.asc"
    })
    result = [{"username": x.get("username"), "full_name": x.get("full_name"), "role": x.get("role")} for x in rows or []]
    LOGIN_CACHE["rows"] = result
    LOGIN_CACHE["expires"] = now + LOGIN_CACHE_TTL
    return result

@router.post("/api/auth/login")
async def login(data: LoginInput) -> Any:
    require_service_key()
    username = data.username.strip().lower()
    profiles = await sb("GET", "/rest/v1/profiles", service=True, params={
        "select": "id,username,full_name,role,active,permissions,all_branches,profile_branches(branch_id)",
        "username": f"eq.{username}", "limit": "1"
    })
    if not profiles or not profiles[0].get("active", True):
        raise HTTPException(401, "اسم المستخدم أو كلمة المرور غير صحيحة")
    auth_user = await sb("GET", f"/auth/v1/admin/users/{profiles[0]['id']}", service=True)
    email = auth_user.get("email")
    if not email:
        raise HTTPException(401, "الحساب غير صالح")
    try:
        result = await sb("POST", "/auth/v1/token?grant_type=password", json={"email": email, "password": data.password})
    except HTTPException as exc:
        if exc.status_code in (400, 401):
            raise HTTPException(401, "اسم المستخدم أو كلمة المرور غير صحيحة") from exc
        raise
    profile = normalize_profile(profiles[0])
    access_token = result.get("access_token")
    if access_token:
        PROFILE_CACHE[access_token] = (dict(profile), time.time() + PROFILE_CACHE_TTL)
    result["profile"] = profile
    return result

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
