"""Iteration 6 (hosted preview): challenge court field (create/propose/accept) and club rivalries board."""
from datetime import datetime, timedelta, timezone

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


def _future(hours):
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


def _cancel(cid, who):
    requests.post(f"{BASE}/api/v1/challenges/{cid}/cancel", headers=auth(who[1]), timeout=20)


# --- Court field on challenges
def test_court_create_propose_accept(alex, blair):
    r = requests.post(f"{API}/challenges", json={"opponent_id": blair[0], "proposed_at": _future(48), "court": "  TEST_ Court 3  "}, headers=auth(alex[1]), timeout=30)
    assert r.status_code in (200, 201), r.text
    c = r.json()
    cid = c["id"]
    try:
        assert c["court"] == "TEST_ Court 3"
        got = next(x for x in requests.get(f"{API}/challenges", headers=auth(blair[1]), timeout=20).json() if x["id"] == cid)
        assert got["court"] == "TEST_ Court 3"
        # propose with a new court
        r = requests.post(f"{BASE}/api/v1/challenges/{cid}/propose", json={"proposed_at": _future(72), "court": "TEST_ Court 7"}, headers=auth(blair[1]), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["court"] == "TEST_ Court 7"
        got = next(x for x in requests.get(f"{API}/challenges", headers=auth(alex[1]), timeout=20).json() if x["id"] == cid)
        assert got["court"] == "TEST_ Court 7" and got["awaiting_you"] is True
        # propose without court keeps the court
        r = requests.post(f"{BASE}/api/v1/challenges/{cid}/propose", json={"proposed_at": _future(80)}, headers=auth(alex[1]), timeout=30)
        assert r.status_code == 200 and r.json()["court"] == "TEST_ Court 7"
        r = requests.post(f"{BASE}/api/v1/challenges/{cid}/respond", json={"action": "accept"}, headers=auth(blair[1]), timeout=20)
        assert r.status_code == 200 and r.json()["status"] == "accepted"
        assert r.json()["court"] == "TEST_ Court 7"
    finally:
        _cancel(cid, alex)


def test_court_too_long_422(alex, blair):
    r = requests.post(f"{API}/challenges", json={"opponent_id": blair[0], "court": "x" * 81}, headers=auth(alex[1]), timeout=20)
    assert r.status_code == 422
    if r.status_code in (200, 201):
        _cancel(r.json()["id"], alex)


def test_court_empty_propose_clears(alex, blair):
    r = requests.post(f"{API}/challenges", json={"opponent_id": blair[0], "proposed_at": _future(48), "court": "TEST_ X"}, headers=auth(alex[1]), timeout=30)
    cid = r.json()["id"]
    try:
        r = requests.post(f"{BASE}/api/v1/challenges/{cid}/propose", json={"proposed_at": _future(60), "court": "  "}, headers=auth(blair[1]), timeout=30)
        assert r.status_code == 200 and r.json()["court"] is None
    finally:
        _cancel(cid, alex)


# --- Rivalries
@pytest.mark.parametrize("kind", ["singles", "doubles"])
def test_rivalries_shape(alex, kind):
    r = requests.get(f"{API}/rivalries", params={"kind": kind}, headers=auth(alex[1]), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["kind"] == kind
    for key in ("most_played", "closest", "one_sided"):
        assert isinstance(d[key], list) and len(d[key]) <= 5
        for p in d[key]:
            assert p["meetings"] >= 2 and p["meetings"] == p["a_wins"] + p["b_wins"] and p["a_wins"] >= p["b_wins"]
    assert all(p["b_wins"] == 0 for p in d["one_sided"])
    assert all(p["b_wins"] > 0 for p in d["closest"])
    mp = [p["meetings"] for p in d["most_played"]]
    assert mp == sorted(mp, reverse=True)


def test_rivalries_alex_blair_present(alex, blair):
    d = requests.get(f"{API}/rivalries", params={"kind": "singles", "limit": 20}, headers=auth(alex[1]), timeout=30).json()
    pairs = [{p["a"]["user_id"], p["b"]["user_id"]} for p in d["most_played"]]
    assert {alex[0], blair[0]} in pairs, d


def test_rivalries_unauth_401():
    assert requests.get(f"{API}/rivalries", params={"kind": "singles"}, timeout=20).status_code == 401


def test_rivalries_bad_kind_and_limit(alex):
    assert requests.get(f"{API}/rivalries", params={"kind": "mixed"}, headers=auth(alex[1]), timeout=20).status_code == 422
    assert requests.get(f"{API}/rivalries", params={"limit": 50}, headers=auth(alex[1]), timeout=20).status_code == 422
