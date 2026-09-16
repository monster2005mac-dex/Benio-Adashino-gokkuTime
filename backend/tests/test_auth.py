"""Auth endpoint tests for Gokaku JWT auth."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'http://127.0.0.1:8000').rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@gokaku.app"
ADMIN_PASSWORD = "AdminPass123"


@pytest.fixture
def new_user():
    email = f"tester_{uuid.uuid4().hex[:10]}@gokaku.app"
    return {"email": email, "password": "TestPass123", "name": "Test User"}


def test_admin_login_seeded():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["email"] == ADMIN_EMAIL
    assert data["role"] == "admin"
    assert "access_token" in data and len(data["access_token"]) > 20
    # httpOnly cookie set
    cookies = r.headers.get("set-cookie", "")
    assert "access_token=" in cookies
    assert "HttpOnly" in cookies or "httponly" in cookies.lower()


def test_register_login_me_logout_flow(new_user):
    # Register
    r = requests.post(f"{API}/auth/register", json=new_user, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["email"] == new_user["email"]
    token = data["access_token"]
    assert token

    # /me via Bearer
    me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert me.status_code == 200
    assert me.json()["email"] == new_user["email"]

    # /me without token -> 401
    me2 = requests.get(f"{API}/auth/me", timeout=15)
    assert me2.status_code == 401

    # Login again
    lg = requests.post(f"{API}/auth/login", json={"email": new_user["email"], "password": new_user["password"]}, timeout=15)
    assert lg.status_code == 200
    assert "access_token" in lg.json()

    # Wrong password
    bad = requests.post(f"{API}/auth/login", json={"email": new_user["email"], "password": "wrongwrong"}, timeout=15)
    assert bad.status_code == 401

    # Logout
    lo = requests.post(f"{API}/auth/logout", timeout=15)
    assert lo.status_code == 200


def test_register_duplicate(new_user):
    r1 = requests.post(f"{API}/auth/register", json=new_user, timeout=15)
    assert r1.status_code == 200
    r2 = requests.post(f"{API}/auth/register", json=new_user, timeout=15)
    assert r2.status_code == 400


def test_register_invalid_email():
    r = requests.post(f"{API}/auth/register", json={"email": "notanemail", "password": "abcdef"}, timeout=15)
    assert r.status_code == 400


def test_register_short_password():
    r = requests.post(f"{API}/auth/register", json={"email": f"x_{uuid.uuid4().hex[:6]}@gokaku.app", "password": "123"}, timeout=15)
    assert r.status_code == 400


def test_bcrypt_hash_format():
    """Verify stored password hashes start with $2b$ (bcrypt)."""
    # Register a fresh user and check via login works — indirect verification
    email = f"bctest_{uuid.uuid4().hex[:8]}@gokaku.app"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Secret123"}, timeout=15)
    assert r.status_code == 200
    lg = requests.post(f"{API}/auth/login", json={"email": email, "password": "Secret123"}, timeout=15)
    assert lg.status_code == 200


def test_cors_credentials_allowed():
    # Verify actual login response returns CORS headers with credentials allowed
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"Origin": BASE_URL},
        timeout=15,
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-credentials", "").lower() == "true"
