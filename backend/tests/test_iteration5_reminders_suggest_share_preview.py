"""Iteration 5 (hosted preview): challenge settings/maintenance, suggest-another-time, public head-to-head, admin email opt-in."""
from datetime import datetime, timedelta, timezone

import pytest
import requests

from test_clerk_preview_auth import BASE, CLUB, SK, auth, mint

pytestmark = pytest.mark.skipif(not (BASE and SK), reason="preview URL / Clerk not configured")
API = f"{BASE}/api/v1/clubs/{CLUB}"
KEYS = ("display_name", "city", "state", "home_club", "image_url", "preferred_sport", "age_group", "gender_category", "visibility")


@pytest.fixture(scope="module")
def alex():
    return mint("alex+clerk_test@example.com")


@pytest.fixture(scope="module")
def blair():
    return mint("blair+clerk_test@example.com")


def _cancel_open(alex, blair):
    for who in (alex, blair):
        for c in requests.get(f"{API}/challenges", headers=auth(who[1]), timeout=20).json():
            if c["status"] in ("pending", "accepted") and c["opponent"]["user_id"] in (alex[0], blair[0]):
                r = requests.post(f"{BASE}/api/v1/challenges/{c['id']}/cancel", headers=auth(who[1]), timeout=20)
                if r.status_code != 200:
                    requests.post(f"{BASE}/api/v1/challenges/{c['id']}/respond", json={"action": "decline"}, headers=auth(who[1]), timeout=20)


def _future(hours):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


# --- Challenge settings
def test_settings_get_member(alex):
    r = requests.get(f"{API}/challenge-settings", headers=auth(alex[1]), timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["reminder_after_days"] == 2 and 3 <= d["challenge_expiry_days"] <= 30


def test_settings_put_admin_and_bounds(blair):
    try:
        r = requests.put(f"{API}/challenge-settings", json={"challenge_expiry_days": 10}, headers=auth(blair[1]), timeout=20)
        assert r.status_code == 200 and r.json()["challenge_expiry_days"] == 10, r.text
        assert requests.get(f"{API}/challenge-settings", headers=auth(blair[1]), timeout=20).json()["challenge_expiry_days"] == 10
        for bad in (1, 2, 31, "x"):
            assert requests.put(f"{API}/challenge-settings", json={"challenge_expiry_days": bad}, headers=auth(blair[1]), timeout=20).status_code == 422
        for ok in (3, 30):
            assert requests.put(f"{API}/challenge-settings", json={"challenge_expiry_days": ok}, headers=auth(blair[1]), timeout=20).status_code == 200
    finally:
        requests.put(f"{API}/challenge-settings", json={"challenge_expiry_days": 7}, headers=auth(blair[1]), timeout=20)


def test_settings_put_player_403(alex):
    assert requests.put(f"{API}/challenge-settings", json={"challenge_expiry_days": 9}, headers=auth(alex[1]), timeout=20).status_code == 403


def test_settings_unauth_401():
    assert requests.put(f"{API}/challenge-settings", json={"challenge_expiry_days": 9}, timeout=20).status_code == 401


# --- Maintenance trigger
def test_maintenance_admin(blair):
    r = requests.post(f"{API}/challenges/maintenance", headers=auth(blair[1]), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert isinstance(d["reminded"], int) and isinstance(d["expired"], int)


def test_maintenance_player_403(alex):
    assert requests.post(f"{API}/challenges/maintenance", headers=auth(alex[1]), timeout=20).status_code == 403


# --- Suggest another time back and forth
def test_suggest_flow(alex, blair):
    _cancel_open(alex, blair)
    r = requests.post(f"{API}/challenges", json={"opponent_id": blair[0], "proposed_at": _future(48)}, headers=auth(alex[1]), timeout=30)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    try:
        assert r.json()["expires_at"]
        # Alex (not his turn) cannot propose/accept
        assert requests.post(f"{BASE}/api/v1/challenges/{cid}/propose", json={"proposed_at": _future(50)}, headers=auth(alex[1]), timeout=20).status_code == 403
        # past time rejected
        assert requests.post(f"{BASE}/api/v1/challenges/{cid}/propose", json={"proposed_at": _future(-5)}, headers=auth(blair[1]), timeout=20).status_code == 422
        t1 = _future(72)
        r = requests.post(f"{BASE}/api/v1/challenges/{cid}/propose", json={"proposed_at": t1, "message": "TEST_ sunday"}, headers=auth(blair[1]), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["awaiting_you"] is False and d["status"] == "pending" and d["message"] == "TEST_ sunday"
        a = next(c for c in requests.get(f"{API}/challenges", headers=auth(alex[1]), timeout=20).json() if c["id"] == cid)
        assert a["awaiting_you"] is True
        assert abs(datetime.fromisoformat(a["proposed_at"].replace("Z", "+00:00")) - datetime.fromisoformat(t1)).total_seconds() < 2
        # Blair can't respond now
        assert requests.post(f"{BASE}/api/v1/challenges/{cid}/respond", json={"action": "accept"}, headers=auth(blair[1]), timeout=20).status_code == 403
        # Alex suggests again
        r = requests.post(f"{BASE}/api/v1/challenges/{cid}/propose", json={"proposed_at": _future(96)}, headers=auth(alex[1]), timeout=30)
        assert r.status_code == 200, r.text
        r = requests.post(f"{BASE}/api/v1/challenges/{cid}/respond", json={"action": "accept"}, headers=auth(blair[1]), timeout=20)
        assert r.status_code == 200 and r.json()["status"] == "accepted", r.text
        # proposing after accept -> 409
        assert requests.post(f"{BASE}/api/v1/challenges/{cid}/propose", json={"proposed_at": _future(99)}, headers=auth(alex[1]), timeout=20).status_code == 409
    finally:
        requests.post(f"{BASE}/api/v1/challenges/{cid}/cancel", headers=auth(alex[1]), timeout=20)


def test_create_expires_reflects_club_setting(alex, blair):
    """create response expires_at should honour the club expiry (not the hardcoded 7)."""
    _cancel_open(alex, blair)
    requests.put(f"{API}/challenge-settings", json={"challenge_expiry_days": 10}, headers=auth(blair[1]), timeout=20)
    cid = None
    try:
        r = requests.post(f"{API}/challenges", json={"opponent_id": blair[0]}, headers=auth(alex[1]), timeout=30)
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        created = datetime.fromisoformat(r.json()["created_at"].replace("Z", "+00:00"))
        exp_create = datetime.fromisoformat(r.json()["expires_at"].replace("Z", "+00:00"))
        listed = next(c for c in requests.get(f"{API}/challenges", headers=auth(alex[1]), timeout=20).json() if c["id"] == cid)
        exp_list = datetime.fromisoformat(listed["expires_at"].replace("Z", "+00:00"))
        assert round((exp_list - created).total_seconds() / 86400) == 10
        assert round((exp_create - created).total_seconds() / 86400) == 10, f"create returned {exp_create - created}"
    finally:
        if cid:
            requests.post(f"{BASE}/api/v1/challenges/{cid}/cancel", headers=auth(alex[1]), timeout=20)
        requests.put(f"{API}/challenge-settings", json={"challenge_expiry_days": 7}, headers=auth(blair[1]), timeout=20)


def test_suggest_notification(alex, blair):
    r = requests.get(f"{BASE}/api/v1/notifications", headers=auth(alex[1]), timeout=20)
    if r.status_code != 200:
        pytest.skip(f"notifications endpoint {r.status_code}")
    data = r.json()
    items = data if isinstance(data, list) else data.get("items", data.get("notifications", []))
    assert any("suggested another time" in (n.get("title") or "") for n in items)


# --- Public head-to-head
def _set_vis(who, vis):
    me = requests.get(f"{API}/players/me", headers=auth(who[1]), timeout=20).json()
    prof = me.get("profile", me)
    prev = prof.get("visibility")
    body = {k: prof.get(k) for k in KEYS if prof.get(k) is not None}
    r = requests.put(f"{API}/players/me", json={**body, "visibility": vis}, headers=auth(who[1]), timeout=20)
    assert r.status_code == 200, r.text
    return prev


def test_public_h2h(alex, blair):
    url = f"{BASE}/api/v1/public/clubs/pprc/head-to-head/{alex[0]}/{blair[0]}"
    pa, pb = _set_vis(alex, "public"), _set_vis(blair, "club")
    try:
        assert requests.get(url, timeout=20).status_code == 404
        _set_vis(blair, "public")
        r = requests.get(url, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["a"]["user_id"] == alex[0] and d["b"]["user_id"] == blair[0] and "singles" in d["summary"]
        assert requests.get(f"{BASE}/api/v1/public/clubs/nope/head-to-head/{alex[0]}/{blair[0]}", timeout=20).status_code == 404
        assert requests.get(f"{BASE}/api/v1/public/clubs/pprc/head-to-head/{alex[0]}/{alex[0]}", timeout=20).status_code == 422
    finally:
        _set_vis(alex, pa or "club")
        _set_vis(blair, pb or "club")


# --- Admin email opt-in
def test_blair_admin_prefs(blair):
    p = requests.get(f"{API}/players/me", headers=auth(blair[1]), timeout=20).json()["preferences"]
    assert p["weekly_recap"] is True and p["monthly_digest"] is True, p
