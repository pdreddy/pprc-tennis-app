"""Iteration 3 (hosted preview): member roles admin, fair match finder, recap permissions, milestone notifications."""

import pytest
import requests

from test_clerk_preview_auth import BASE, CLUB, SK, auth, mint

pytestmark = pytest.mark.skipif(not (BASE and SK), reason="preview URL / Clerk not configured")
API = f"{BASE}/api/v1/clubs/{CLUB}"


@pytest.fixture(scope="module")
def alex():
    return mint("alex+clerk_test@example.com")


@pytest.fixture(scope="module")
def blair():
    return mint("blair+clerk_test@example.com")


# --- Members & roles
def test_members_forbidden_for_player(alex):
    r = requests.get(f"{API}/members", headers=auth(alex[1]), timeout=20)
    assert r.status_code == 403


def test_members_unauth_401():
    assert requests.get(f"{API}/members", timeout=20).status_code == 401


def test_members_list_as_admin(blair, alex):
    r = requests.get(f"{API}/members", headers=auth(blair[1]), timeout=20)
    assert r.status_code == 200, r.text
    rows = r.json()
    me = [m for m in rows if m["is_you"]]
    assert len(me) == 1 and me[0]["user_id"] == blair[0] and me[0]["role"] == "admin"
    assert any(m["user_id"] == alex[0] for m in rows)
    assert any(m["role"] == "owner" for m in rows)


def test_patch_own_role_409(blair):
    r = requests.patch(f"{API}/members/{blair[0]}", json={"role": "player"}, headers=auth(blair[1]), timeout=20)
    assert r.status_code == 409


def test_patch_owner_409(blair):
    r = requests.patch(f"{API}/members/admin", json={"role": "player"}, headers=auth(blair[1]), timeout=20)
    assert r.status_code == 409


def test_patch_invalid_role_422(blair, alex):
    r = requests.patch(f"{API}/members/{alex[0]}", json={"role": "owner"}, headers=auth(blair[1]), timeout=20)
    assert r.status_code == 422


def test_patch_unknown_member_404(blair):
    r = requests.patch(f"{API}/members/nope-user", json={"role": "player"}, headers=auth(blair[1]), timeout=20)
    assert r.status_code == 404


def test_patch_by_player_403(alex, blair):
    r = requests.patch(f"{API}/members/{blair[0]}", json={"role": "player"}, headers=auth(alex[1]), timeout=20)
    assert r.status_code == 403


def test_patch_role_roundtrip_and_notification(blair, alex):
    r = requests.patch(f"{API}/members/{alex[0]}", json={"role": "organizer"}, headers=auth(blair[1]), timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "organizer"
    rows = requests.get(f"{API}/members", headers=auth(blair[1]), timeout=20).json()
    assert next(m for m in rows if m["user_id"] == alex[0])["role"] == "organizer"
    notes = requests.get(f"{BASE}/api/v1/notifications", headers=auth(alex[1]), timeout=20)
    if notes.status_code == 200:
        body = notes.json()
        items = body if isinstance(body, list) else body.get("items", body.get("notifications", []))
        assert any("You are now organizer" in (n.get("title") or "") for n in items)
    # restore
    r = requests.patch(f"{API}/members/{alex[0]}", json={"role": "player"}, headers=auth(blair[1]), timeout=20)
    assert r.status_code == 200 and r.json()["role"] == "player"


# --- Fair match finder
@pytest.mark.parametrize("spread", [0.25, 0.5, 1.0])
def test_opponents_sorted(alex, spread):
    r = requests.get(f"{API}/players/me/opponents", params={"spread": spread}, headers=auth(alex[1]), timeout=20)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert all(abs(x["gap"]) <= spread + 1e-9 for x in rows)
    assert all(x["user_id"] != alex[0] for x in rows)
    for prov in (False, True):
        gaps = [abs(x["gap"]) for x in rows if x["provisional"] is prov]
        assert gaps == sorted(gaps)
    for x in rows:
        assert set(x["head_to_head"]) == {"wins", "losses"}


def test_opponents_doubles_and_validation(alex):
    assert requests.get(f"{API}/players/me/opponents", params={"kind": "doubles"}, headers=auth(alex[1]), timeout=20).status_code == 200
    assert requests.get(f"{API}/players/me/opponents", params={"kind": "mixed"}, headers=auth(alex[1]), timeout=20).status_code == 422
    assert requests.get(f"{API}/players/me/opponents", params={"spread": 5}, headers=auth(alex[1]), timeout=20).status_code == 422


def test_opponents_unauth_401():
    assert requests.get(f"{API}/players/me/opponents", timeout=20).status_code == 401


# --- Recaps permissions
def test_recaps_send_as_player_403(alex):
    assert requests.post(f"{API}/recaps/send", headers=auth(alex[1]), timeout=30).status_code == 403


def test_recaps_send_unauth_401():
    assert requests.post(f"{API}/recaps/send", timeout=20).status_code == 401


# --- Profile preferences exposed
def test_me_has_preferences(alex):
    d = requests.get(f"{API}/players/me", headers=auth(alex[1]), timeout=20).json()
    assert d["preferences"]["email"] == "alex+clerk_test@example.com"
    assert isinstance(d["preferences"]["weekly_recap"], bool)
