from fastapi import APIRouter, Depends
from ..core import *

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/supplier-categories")
async def list_supplier_categories(profile: dict[str, Any] = Depends(current_profile)) -> Any:
    perms = effective_permissions(profile)
    if not (perms.get("view_dashboard") or perms.get("view_suppliers") or perms.get("manage_suppliers")):
        raise HTTPException(403, "ليس لديك صلاحية عرض تصنيفات الموردين")
    return await sb(
        "GET", "/rest/v1/supplier_categories", service=True,
        params={"select": "id,name,created_at", "order": "name.asc", "limit": "1000"},
    )


@router.post("/supplier-categories")
async def create_supplier_category(data: SupplierCategoryInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_suppliers")
    name = data.name.strip()
    existing = await sb(
        "GET", "/rest/v1/supplier_categories", service=True,
        params={"select": "id", "name": f"eq.{name}", "limit": "1"},
    )
    if existing:
        raise HTTPException(409, "يوجد تصنيف بنفس الاسم")
    rows = await sb(
        "POST", "/rest/v1/supplier_categories", service=True,
        headers={"Prefer": "return=representation"}, json={"name": name},
    )
    return rows[0]


@router.put("/supplier-categories/{category_id}")
async def update_supplier_category(category_id: str, data: SupplierCategoryInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_suppliers")
    name = data.name.strip()
    existing = await sb(
        "GET", "/rest/v1/supplier_categories", service=True,
        params={"select": "id", "name": f"eq.{name}", "id": f"neq.{category_id}", "limit": "1"},
    )
    if existing:
        raise HTTPException(409, "يوجد تصنيف بنفس الاسم")
    rows = await sb(
        "PATCH", "/rest/v1/supplier_categories", service=True,
        headers={"Prefer": "return=representation"}, params={"id": f"eq.{category_id}"}, json={"name": name},
    )
    if not rows:
        raise HTTPException(404, "التصنيف غير موجود")
    return rows[0]


@router.delete("/supplier-categories/{category_id}")
async def delete_supplier_category(category_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_suppliers")
    linked = await sb(
        "GET", "/rest/v1/supplier_category_links", service=True,
        params={"select": "supplier_id", "category_id": f"eq.{category_id}", "limit": "1"},
    )
    if linked:
        raise HTTPException(409, "لا يمكن حذف التصنيف لأنه مرتبط بموردين؛ أزل التصنيف من الموردين أولًا")
    await sb("DELETE", "/rest/v1/supplier_categories", service=True, params={"id": f"eq.{category_id}"})
    return {"ok": True}

@router.get("/branches")
async def list_branches(profile: dict[str, Any] = Depends(current_profile)) -> Any:
    # Everyone needs the names of branches they can use; managers get all branches.
    params: dict[str, str] = {"select": "id,name,active,created_at", "order": "name.asc", "limit": "1000"}
    if not effective_permissions(profile).get("manage_branches"):
        allowed = branch_ids_for(profile)
        if allowed is not None:
            if not allowed:
                return []
            params["id"] = f"in.({','.join(sorted(allowed))})"
    return await sb("GET", "/rest/v1/branches", service=True, params=params)

@router.post("/branches")
async def create_branch(data: BranchInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_branches")
    existing = await sb("GET", "/rest/v1/branches", service=True, params={"select": "id", "name": f"eq.{data.name.strip()}", "limit": "1"})
    if existing:
        raise HTTPException(409, "يوجد فرع بنفس الاسم")
    rows = await sb("POST", "/rest/v1/branches", service=True, headers={"Prefer": "return=representation"}, json={"name": data.name.strip(), "active": True})
    return rows[0]

@router.put("/branches/{branch_id}")
async def update_branch(branch_id: str, data: BranchUpdateInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_branches")
    rows = await sb("PATCH", "/rest/v1/branches", service=True, headers={"Prefer": "return=representation"}, params={"id": f"eq.{branch_id}"}, json={"name": data.name.strip(), "active": data.active})
    if not rows:
        raise HTTPException(404, "الفرع غير موجود")
    return rows[0]

@router.delete("/branches/{branch_id}")
async def delete_branch(branch_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_branches")
    for table in ("invoices", "payments", "payment_plans", "profile_branches"):
        linked = await sb("GET", f"/rest/v1/{table}", service=True, params={"select": "id" if table != "profile_branches" else "profile_id", "branch_id": f"eq.{branch_id}", "limit": "1"})
        if linked:
            raise HTTPException(409, "لا يمكن حذف الفرع لوجود بيانات مرتبطة به؛ أوقفه بدلًا من الحذف")
    await sb("DELETE", "/rest/v1/branches", service=True, params={"id": f"eq.{branch_id}"})
    return {"ok": True}

@router.get("/users")
async def list_users(profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_users")
    rows = await sb("GET", "/rest/v1/profiles", service=True, params={
        "select": "id,username,full_name,role,active,permissions,all_branches,created_at,profile_branches(branch_id,branches(name))", "order": "created_at.desc", "limit": "1000"
    })
    for row in rows or []:
        row["branch_ids"] = [x.get("branch_id") for x in row.get("profile_branches") or []]
        row["effective_permissions"] = effective_permissions(row)
    return rows

async def _replace_user_branches(user_id: str, branch_ids: list[str]) -> None:
    await sb("DELETE", "/rest/v1/profile_branches", service=True, params={"profile_id": f"eq.{user_id}"})
    if branch_ids:
        await sb("POST", "/rest/v1/profile_branches", service=True, json=[{"profile_id": user_id, "branch_id": bid} for bid in list(dict.fromkeys(branch_ids))])

def _validate_user_scope(actor: dict[str, Any], *, role: str, all_branches: bool, branch_ids: list[str]) -> None:
    actor_scope = branch_ids_for(actor)
    if actor_scope is not None:
        if all_branches or role == "admin":
            raise HTTPException(403, "لا يمكنك منح صلاحية كل الفروع أو دور المدير")
        requested = set(branch_ids)
        if not requested.issubset(actor_scope):
            raise HTTPException(403, "لا يمكنك منح فروع خارج نطاقك")


@router.post("/users")
async def create_user(data: UserCreateInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_users")
    require_service_key()
    _validate_user_scope(profile, role=data.role, all_branches=data.all_branches, branch_ids=data.branch_ids)
    username = data.username.strip().lower()
    existing = await sb("GET", "/rest/v1/profiles", service=True, params={"select": "id", "username": f"eq.{username}", "limit": "1"})
    if existing:
        raise HTTPException(409, "اسم المستخدم مستخدم بالفعل")
    auth_user = await sb("POST", "/auth/v1/admin/users", service=True, json={
        "email": f"{username}@abdo-debts.app", "password": data.password, "email_confirm": True,
        "user_metadata": {"username": username, "full_name": data.full_name.strip()},
    })
    uid = auth_user["id"]
    clean_permissions = {k: bool(v) for k, v in data.permissions.items() if k in PERMISSION_KEYS}
    try:
        rows = await sb("POST", "/rest/v1/profiles", service=True, headers={"Prefer": "return=representation"}, json={
            "id": uid, "username": username, "full_name": data.full_name.strip(), "role": data.role,
            "active": True, "permissions": clean_permissions, "all_branches": bool(data.all_branches or data.role == "admin"),
        })
        if not (data.all_branches or data.role == "admin"):
            await _replace_user_branches(uid, data.branch_ids)
    except Exception:
        await sb("DELETE", f"/auth/v1/admin/users/{uid}", service=True)
        raise
    clear_login_cache(); clear_profile_cache()
    return rows[0]

@router.put("/users/{user_id}")
async def update_user(user_id: str, data: UserUpdateInput, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_users")
    require_service_key()
    _validate_user_scope(profile, role=data.role, all_branches=data.all_branches, branch_ids=data.branch_ids)
    username = data.username.strip().lower()
    existing = await sb("GET", "/rest/v1/profiles", service=True, params={"select": "id", "username": f"eq.{username}", "id": f"neq.{user_id}", "limit": "1"})
    if existing:
        raise HTTPException(409, "اسم المستخدم مستخدم بالفعل")
    auth_payload: dict[str, Any] = {"user_metadata": {"username": username, "full_name": data.full_name.strip()}, "ban_duration": "none" if data.active else "876000h"}
    if data.password:
        auth_payload["password"] = data.password
    await sb("PUT", f"/auth/v1/admin/users/{user_id}", service=True, json=auth_payload)
    clean_permissions = {k: bool(v) for k, v in data.permissions.items() if k in PERMISSION_KEYS}
    all_branches = bool(data.all_branches or data.role == "admin")
    rows = await sb("PATCH", "/rest/v1/profiles", service=True, headers={"Prefer": "return=representation"}, params={"id": f"eq.{user_id}"}, json={
        "username": username, "full_name": data.full_name.strip(), "role": data.role, "active": data.active,
        "permissions": clean_permissions, "all_branches": all_branches,
    })
    await _replace_user_branches(user_id, [] if all_branches else data.branch_ids)
    clear_login_cache(); clear_profile_cache(user_id)
    return rows[0]

@router.delete("/users/{user_id}")
async def delete_user(user_id: str, profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_users")
    require_service_key()
    if user_id == profile["id"]:
        raise HTTPException(422, "لا يمكنك حذف حسابك الحالي")
    # Keep financial history referentially safe; creator columns are ON DELETE SET NULL.
    await sb("DELETE", "/rest/v1/profiles", service=True, params={"id": f"eq.{user_id}"})
    await sb("DELETE", f"/auth/v1/admin/users/{user_id}", service=True)
    clear_login_cache(); clear_profile_cache(user_id)
    return {"ok": True}

@router.get("/permissions")
async def permissions(profile: dict[str, Any] = Depends(current_profile)) -> Any:
    require_permission(profile, "manage_users")
    return {"keys": sorted(PERMISSION_KEYS), "roles": ROLE_DEFAULT_PERMISSIONS}
