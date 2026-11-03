"""Iteration 2: hosted preview Clerk auth, join, photo upload/serve, milestones (runs against REACT_APP_BACKEND_URL)."""
import json
import os
import struct
import urllib.parse
import zlib

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
SK = os.environ.get("CLERK_SECRET_KEY")
CLUB = "82a25bc1-9def-58d4-bc37-4be4c1b8fd6d"
H = {"Authorization": f"Bearer {SK}", "Content-Type": "application/json", "User-Agent": "emergent-test"}

pytestmark = pytest.mark.skipif(not (BASE and SK), reason="preview URL / Clerk not configured")


def clerk(path, body=None, method="POST"):
    r = requests.request(method, "https://api.clerk.com/v1" + path, headers=H, data=json.dumps(body) if body is not None else None, timeout=20)
    r.raise_for_status()
    return r.json()


def mint(email):
    users = clerk(f"/users?email_address={urllib.parse.quote(email)}", method="GET")
    assert users, f"{email} missing in Clerk"
    s = clerk("/sessions", {"user_id": users[0]["id"]})
    return users[0]["id"], clerk(f"/sessions/{s['id']}/tokens", {"expires_in_seconds": 900})["jwt"]


@pytest.fixture(scope="module")
def alex():
    return mint("alex+clerk_test@example.com")


@pytest.fixture(scope="module")
def blair():
    return mint("blair+clerk_test@example.com")


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def png_bytes():
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * 4 for _ in range(4))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


# --- Clerk config & auth boundary
def test_clerk_config_enabled():
    d = requests.get(f"{BASE}/api/clerk/config", timeout=15).json()
    assert d["enabled"] is True and d["publishable_key"].startswith("pk_")


def test_protected_without_token_401():
    r = requests.get(f"{BASE}/api/v1/clubs/{CLUB}/players/me", timeout=15)
    assert r.status_code == 401


def test_dev_header_rejected_401():
    r = requests.get(f"{BASE}/api/v1/clubs/{CLUB}/players/me", headers={"X-PPRC-User": "player1"}, timeout=15)
    assert r.status_code == 401


def test_invalid_bearer_401():
    r = requests.get(f"{BASE}/api/v1/clubs/{CLUB}/players/me", headers=auth("not-a-jwt"), timeout=15)
    assert r.status_code == 401


def test_bearer_200_me(alex):
    r = requests.get(f"{BASE}/api/v1/clubs/{CLUB}/players/me", headers=auth(alex[1]), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["profile"]["display_name"] == "Alex Tester"
    assert d["ratings"]["singles"]["verified_matches"] >= 5
    ids = [m["id"] for m in d["milestones"]]
    assert "singles-established" in ids


# --- Self-join
def test_join_idempotent(alex):
    r1 = requests.post(f"{BASE}/api/v1/clubs/{CLUB}/join", headers=auth(alex[1]), timeout=15)
    r2 = requests.post(f"{BASE}/api/v1/clubs/{CLUB}/join", headers=auth(alex[1]), timeout=15)
    assert r1.status_code == r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"] and r1.json()["role"] == "player"
    assert r1.json()["user_id"] == alex[0]


def test_join_unknown_club_404(alex):
    r = requests.post(f"{BASE}/api/v1/clubs/00000000-0000-0000-0000-000000000000/join", headers=auth(alex[1]), timeout=15)
    assert r.status_code == 404


# --- Photo upload / serve
def test_photo_upload_and_serve(alex):
    r = requests.post(f"{BASE}/api/v1/clubs/{CLUB}/players/me/photo", headers=auth(alex[1]),
                      files={"file": ("a.png", png_bytes(), "image/png")}, timeout=30)
    assert r.status_code == 200, r.text
    url = r.json()["image_url"]
    assert url.startswith("/api/v1/player-photos/")
    g = requests.get(BASE + url, timeout=20)
    assert g.status_code == 200 and g.headers["content-type"].startswith("image/png")
    me = requests.get(f"{BASE}/api/v1/clubs/{CLUB}/players/me", headers=auth(alex[1]), timeout=15).json()
    assert me["profile"].get("image_url") == url


def test_photo_non_image_415(alex):
    r = requests.post(f"{BASE}/api/v1/clubs/{CLUB}/players/me/photo", headers=auth(alex[1]),
                      files={"file": ("a.txt", b"hello", "text/plain")}, timeout=15)
    assert r.status_code == 415


def test_photo_too_big_413(alex):
    r = requests.post(f"{BASE}/api/v1/clubs/{CLUB}/players/me/photo", headers=auth(alex[1]),
                      files={"file": ("a.jpg", b"\xff" * 3_000_100, "image/jpeg")}, timeout=60)
    assert r.status_code == 413


def test_photo_unauth_401():
    r = requests.post(f"{BASE}/api/v1/clubs/{CLUB}/players/me/photo", files={"file": ("a.png", png_bytes(), "image/png")}, timeout=15)
    assert r.status_code == 401


def test_photo_unknown_path_404():
    r = requests.get(f"{BASE}/api/v1/player-photos/pprc/player-photos/x/nope.jpg", timeout=15)
    assert r.status_code == 404


# --- Rankings / directory with real auth
def test_rankings_and_directory(alex):
    r = requests.get(f"{BASE}/api/v1/clubs/{CLUB}/rankings?kind=singles", headers=auth(alex[1]), timeout=15)
    assert r.status_code == 200, r.text
    assert "Alex Tester" in r.text
    p = requests.get(f"{BASE}/api/v1/clubs/{CLUB}/players", headers=auth(alex[1]), timeout=15)
    assert p.status_code == 200, p.text
    assert "Alex Tester" in p.text


# --- Match report + confirm with real auth (Alex reports vs Blair, Blair confirms)
def test_report_and_confirm(alex, blair):
    r = requests.post(f"{BASE}/api/v1/clubs/{CLUB}/match-results", headers=auth(alex[1]),
                      json={"opponent_ids": [blair[0]], "score_text": "6-4 3-6 10-8"}, timeout=15)
    assert r.status_code in (200, 201), r.text
    mid = r.json()["id"]
    c = requests.post(f"{BASE}/api/v1/match-results/{mid}/confirm", headers=auth(blair[1]), timeout=15)
    assert c.status_code == 200, c.text
    # Alex cannot confirm his own report
    r2 = requests.post(f"{BASE}/api/v1/clubs/{CLUB}/match-results", headers=auth(alex[1]),
                       json={"opponent_ids": [blair[0]], "score_text": "6-4 6-4"}, timeout=15)
    mid2 = r2.json()["id"]
    self_c = requests.post(f"{BASE}/api/v1/match-results/{mid2}/confirm", headers=auth(alex[1]), timeout=15)
    assert self_c.status_code in (403, 409, 422), self_c.text
    requests.post(f"{BASE}/api/v1/match-results/{mid2}/confirm", headers=auth(blair[1]), timeout=15)
