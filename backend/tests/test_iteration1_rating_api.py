# Iteration 1 regression: PPRC Rating API against the hosted preview (demo club + throwaway clubs).
# Skipped unless REACT_APP_BACKEND_URL points at a running API-mode preview with the demo seed.
import os
import uuid

import pytest

if not os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("PPRC_PREVIEW_DEV_HEADER") != "1":
    pytest.skip("hosted-preview regression; set REACT_APP_BACKEND_URL and PPRC_PREVIEW_DEV_HEADER=1", allow_module_level=True)
requests = pytest.importorskip("requests")

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
CLUB = "82a25bc1-9def-58d4-bc37-4be4c1b8fd6d"
S = requests.Session()


def call(method, path, user=None, **kw):
    headers = {"X-PPRC-User": user} if user else {}
    return S.request(method, f"{BASE}{path}", headers=headers, timeout=30, **kw)


def new_club(n=4, visibility="club"):
    owner = f"TEST_owner-{uuid.uuid4().hex[:8]}"
    club = call("POST", "/v1/clubs", owner, json={"slug": f"test-{uuid.uuid4().hex[:8]}", "name": "TEST club"}).json()
    players = [f"TEST_p-{uuid.uuid4().hex[:6]}-{i}" for i in range(n)]
    for p in players:
        assert call("POST", f"/v1/clubs/{club['id']}/memberships", owner, json={"user_id": p, "display_name": p, "role": "player"}).status_code < 400
        assert call("PUT", f"/v1/clubs/{club['id']}/players/me", p, json={"display_name": p, "visibility": visibility, "starting_singles": 6}).status_code == 200
    return owner, club["id"], players


# Formula / public endpoints
def test_formula_version():
    r = call("GET", "/v1/rating/formula")
    assert r.status_code == 200 and r.json()["version"] == "pprc-rating-1.0"
    assert r.json()["min"] == 1.0 and r.json()["max"] == 16.5


def test_public_rankings():
    r = call("GET", "/v1/public/rankings")
    assert r.status_code == 200
    d = r.json()
    assert d["scope"] == "platform"
    ratings = [i["rating"] for i in d["items"]]
    assert ratings == sorted(ratings, reverse=True)
    assert all(i["verified_matches"] > 0 for i in d["items"])


# Club rankings (demo club)
def test_club_rankings_sorted_and_private_hidden():
    d = call("GET", f"/v1/clubs/{CLUB}/rankings?kind=singles", "player1").json()
    ratings = [i["rating"] for i in d["items"]]
    assert ratings == sorted(ratings, reverse=True) and len(ratings) > 0
    assert all(1.0 <= x <= 16.5 for x in ratings)
    assert "player16" not in [i["user_id"] for i in d["items"]]
    admin = call("GET", f"/v1/clubs/{CLUB}/rankings?kind=singles&page_size=100", "admin").json()
    print("admin ranking total", admin["total"], "player total", d["total"])


def test_club_rankings_doubles_and_filters():
    d = call("GET", f"/v1/clubs/{CLUB}/rankings?kind=doubles", "player1")
    assert d.status_code == 200 and d.json()["kind"] == "doubles"
    f = call("GET", f"/v1/clubs/{CLUB}/rankings?kind=singles&min_rating=5&max_rating=8", "player1").json()
    assert all(5 <= i["rating"] <= 8 for i in f["items"])
    p = call("GET", f"/v1/clubs/{CLUB}/rankings?page_size=2&page=2", "player1").json()
    assert p["page"] == 2 and len(p["items"]) <= 2 and (not p["items"] or p["items"][0]["rank"] == 3)


def test_tenant_isolation():
    assert call("GET", f"/v1/clubs/{CLUB}/rankings?kind=singles", "visitor").status_code == 403
    assert call("GET", f"/v1/clubs/{CLUB}/players", "TEST_stranger").status_code == 403
    assert call("GET", f"/v1/clubs/{CLUB}/players/me", "visitor").status_code == 403


def test_directory_private_player():
    names = [i["user_id"] for i in call("GET", f"/v1/clubs/{CLUB}/players?page_size=100", "player1").json()["items"]]
    assert "player16" not in names and "player2" in names
    admin = [i["user_id"] for i in call("GET", f"/v1/clubs/{CLUB}/players?page_size=100", "admin").json()["items"]]
    assert "player16" in admin
    assert call("GET", f"/v1/clubs/{CLUB}/players/player16", "player1").status_code == 404
    assert call("GET", f"/v1/clubs/{CLUB}/players/player16", "admin").status_code == 200
    q = call("GET", f"/v1/clubs/{CLUB}/players?q=Player 1", "player1").json()["items"]
    assert all("player 1" in i["display_name"].lower() for i in q)


# Reporting / confirm / dispute / void (throwaway club)
def test_report_confirm_void_cycle():
    owner, club, (a, b, *_r) = new_club()
    res = call("POST", f"/v1/clubs/{club}/match-results", a, json={"opponent_ids": [b], "score_text": "6-4 6-4"}).json()
    assert res["status"] == "reported"
    assert call("POST", f"/v1/match-results/{res['id']}/confirm", a).status_code == 403
    c = call("POST", f"/v1/match-results/{res['id']}/confirm", b).json()
    assert c["status"] == "finalized" and c["rated"] is True
    ra = call("GET", f"/v1/clubs/{club}/players/me", a).json()["ratings"]
    assert ra["singles"]["rating"] > 6 and ra["singles"]["verified_matches"] == 1 and ra["singles"]["provisional"]
    assert ra["doubles"]["verified_matches"] == 0
    # player cannot void finalized; organizer can and rating reverts
    assert call("POST", f"/v1/match-results/{res['id']}/void", a, json={"reason": "mistake"}).status_code == 403
    v = call("POST", f"/v1/match-results/{res['id']}/void", owner, json={"reason": "mistake"}).json()
    assert v["status"] == "cancelled"
    assert call("GET", f"/v1/clubs/{club}/players/me", a).json()["ratings"]["singles"]["rating"] == 6.0


def test_dispute_then_verify():
    owner, club, (a, b, *_r) = new_club()
    res = call("POST", f"/v1/clubs/{club}/match-results", a, json={"opponent_ids": [b], "score_text": "6-4 6-4"}).json()
    assert call("POST", f"/v1/match-results/{res['id']}/dispute", b, json={"reason": "no"}).status_code == 422
    d = call("POST", f"/v1/match-results/{res['id']}/dispute", b, json={"reason": "Score was 4-6 6-4 10-8"}).json()
    assert d["status"] == "disputed"
    assert call("POST", f"/v1/match-results/{res['id']}/confirm", b).status_code == 409
    assert call("POST", f"/v1/match-results/{res['id']}/finalize", a, json={"reason": "verify it"}).status_code == 403
    f = call("POST", f"/v1/match-results/{res['id']}/finalize", owner, json={"score_text": "4-6 6-4 10-8", "reason": "corrected"}).json()
    assert f["status"] == "finalized" and f["rated"]


@pytest.mark.parametrize("outcome,extra", [("walkover", {"winner_side": 1}), ("incomplete", {}), ("no_score", {"winner_side": 1})])
def test_unrated_outcomes(outcome, extra):
    _o, club, (a, b, *_r) = new_club()
    res = call("POST", f"/v1/clubs/{club}/match-results", a, json={"opponent_ids": [b], "outcome": outcome, **extra})
    assert res.status_code == 201, res.text
    c = call("POST", f"/v1/match-results/{res.json()['id']}/confirm", b).json()
    assert c["rated"] is False
    s = call("GET", f"/v1/clubs/{club}/players/me", a).json()["ratings"]["singles"]
    assert s["rating"] == 6.0 and s["verified_matches"] == 0


def test_doubles_only_affects_doubles_and_partner_history():
    _o, club, (a, b, c, d) = new_club()
    res = call("POST", f"/v1/clubs/{club}/match-results", a, json={"kind": "doubles", "partner_id": b, "opponent_ids": [c, d], "score_text": "6-2 6-3"}).json()
    call("POST", f"/v1/match-results/{res['id']}/confirm", c)
    me = call("GET", f"/v1/clubs/{club}/players/me", a).json()
    assert me["ratings"]["doubles"]["verified_matches"] == 1 and me["ratings"]["singles"]["verified_matches"] == 0
    assert [p["user_id"] for p in me["doubles_partners"]] == [b]


def test_doubles_partner_cannot_be_self():
    _o, club, (a, b, c, _d) = new_club()
    r = call("POST", f"/v1/clubs/{club}/match-results", a, json={"kind": "doubles", "partner_id": a, "opponent_ids": [b, c], "score_text": "6-2 6-3"})
    assert r.status_code == 422, f"self as partner accepted: {r.status_code} {r.text[:200]}"


def test_report_validation():
    _o, club, (a, b, *_r) = new_club()
    assert call("POST", f"/v1/clubs/{club}/match-results", a, json={"opponent_ids": [a], "score_text": "6-1 6-1"}).status_code == 422
    assert call("POST", f"/v1/clubs/{club}/match-results", a, json={"opponent_ids": ["TEST_nobody"], "score_text": "6-1 6-1"}).status_code == 422
    assert call("POST", f"/v1/clubs/{club}/match-results", a, json={"opponent_ids": [b], "score_text": "6-1 6-1", "outcome": "bogus"}).status_code == 422
    assert call("POST", f"/v1/clubs/{club}/match-results", a, json={"opponent_ids": [b], "score_text": "6-1 6-1", "played_at": "2099-01-01T00:00:00Z"}).status_code == 422


def test_starting_level_locked_after_verified_match():
    _o, club, (a, b, *_r) = new_club()
    res = call("POST", f"/v1/clubs/{club}/match-results", a, json={"opponent_ids": [b], "score_text": "6-4 6-4"}).json()
    call("POST", f"/v1/match-results/{res['id']}/confirm", b)
    r = call("PUT", f"/v1/clubs/{club}/players/me", a, json={"display_name": a, "starting_singles": 9})
    assert r.status_code == 409
    assert call("PUT", f"/v1/clubs/{club}/players/me", a, json={"display_name": a, "starting_singles": 20}).status_code == 422
