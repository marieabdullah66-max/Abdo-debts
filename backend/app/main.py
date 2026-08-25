from __future__ import annotations

import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .core import FRONTEND, close_http_client
from .routers import admin, auth, dashboard, invoices, payments, suppliers

app = FastAPI(title="Abdo Debts API", version="1.0.0")

allowed_origins = [x.strip() for x in os.getenv("ALLOWED_ORIGINS", "").split(",") if x.strip()]
if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else "no-cache"
    return response

@app.on_event("shutdown")
async def shutdown_http_client() -> None:
    await close_http_client()

for router in (auth.router, dashboard.router, suppliers.router, invoices.router, payments.router, admin.router):
    app.include_router(router)

app.mount("/assets", StaticFiles(directory=FRONTEND), name="assets")
