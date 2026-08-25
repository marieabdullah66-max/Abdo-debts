from __future__ import annotations
import argparse, os, sys
from pathlib import Path
import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "backend" / ".env")
URL = os.getenv("SUPABASE_URL", "").rstrip("/")
KEY = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

parser = argparse.ArgumentParser(description="Create the first Abdo Debts admin")
parser.add_argument("username")
parser.add_argument("full_name")
parser.add_argument("password")
args = parser.parse_args()
if not URL or not KEY:
    sys.exit("Missing SUPABASE_URL / SUPABASE_SECRET_KEY in backend/.env")
username = args.username.strip().lower()
headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
with httpx.Client(timeout=30) as client:
    r = client.post(f"{URL}/auth/v1/admin/users", headers=headers, json={
        "email": f"{username}@abdo-debts.app", "password": args.password, "email_confirm": True,
        "user_metadata": {"username": username, "full_name": args.full_name.strip()},
    })
    r.raise_for_status(); uid = r.json()["id"]
    r = client.post(f"{URL}/rest/v1/profiles", headers={**headers, "Prefer": "return=representation"}, json={
        "id": uid, "username": username, "full_name": args.full_name.strip(), "role": "admin", "active": True, "permissions": {}, "all_branches": True,
    })
    if r.status_code >= 400:
        client.delete(f"{URL}/auth/v1/admin/users/{uid}", headers=headers)
        r.raise_for_status()
print(f"Admin created: {username}")
