"""Iteration 4 (hosted preview): email preview/test, challenges, head-to-head, monthly digest pref."""
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


def _cancel_open(alex, blair):
    for who in (alex, blair):
        for c in requests.get(f"{API}/challenges", headers=auth(who[1]), timeout=20).json():
            if c["status"] in ("pending", "accepted") and c["opponent"]["user_id"] in (alex[0], blair[0]):
                if c["direction"] == "sent" or c["status"] == "accepted":
                    requests.post(f"{BASE}/api/v1/challenges/{c['id']}/cancel", headers=auth(who[1]), timeout=20)
                else:
                    requests.post(f"{BASE}/api/v1/challenges/{c['id']}/respond", json={"action": "decline"}, headers=auth(who[1]), timeout=20)


# --- Email preview (admin only)
def test_preview_weekly_admin(blair):
    r = requests.get(f"{API}/emails/preview", params={"type": "weekly"}, headers=auth(blair[1]), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["type"] == "weekly" and d["subject"] and "<" in d["html"] and isinstance(d["recipients"], int)


def test_preview_weekly_other_member(blair, alex):
    r = requests.get(f"{API}/emails/preview", params={"type": "weekly", "user_id": alex[0]}, headers=auth(blair[1]), timeout=30)
    assert r.status_code == 200, r.text
    assert "Alex" in r.json()["html"]


def test_preview_monthly_admin(blair):
    r = requests.get(f"{API}/emails/preview", params={"type": "monthly"}, headers=auth(blair[1]), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["type"] == "monthly" and d["subject"] and isinstance(d["recipients"], int)


def test_preview_invalid_type_422(blair):
    assert requests.get(f"{API}/emails/preview", params={"type": "daily"}, headers=auth(blair[1]), timeout=20).status_code == 422


def test_preview_unknown_member_404(blair):
    r = requests.get(f"{API}/emails/preview", params={"user_id": "nobody-x"}, headers=auth(blair[1]), timeout=20)
    assert r.status_code in (403, 404), r.text


def test_preview_player_403(alex):
    assert requests.get(f"{API}/emails/preview", headers=auth(alex[1]), timeout=20).status_code == 403
    assert requests.post(f"{API}/emails/test", json={"type": "weekly"}, headers=auth(alex[1]), timeout=20).status_code == 403


def test_preview_unauth_401():
    assert requests.get(f"{API}/emails/preview", timeout=20).status_code == 401


def test_send_test_email_and_rate_limit(blair):
    r1 = requests.post(f"{API}/emails/test", json={"type": "monthly"}, headers=auth(blair[1]), timeout=30)
    assert r1.status_code in (200, 429), r1.text
    if r1.status_code == 200:
        assert r1.json()["sent_to"] == "blair+clerk_test@example.com"
    r2 = requests.post(f"{API}/emails/test", json={"type": "weekly"}, headers=auth(blair[1]), timeout=30)
    assert r2.status_code == 429 and "minute" in r2.json()["detail"].lower()


# --- Challenges
def test_challenge_validation(alex):
    assert requests.post(f"{API}/challenges", json={"opponent_id": alex[0]}, headers=auth(alex[1]), timeout=20).status_code == 422
    assert requests.post(f"{API}/challenges", json={"opponent_id": "ghost-user"}, headers=auth(alex[1]), timeout=20).status_code == 404
    assert requests.post(f"{API}/challenges", json={"opponent_id": "x", "kind": "doubles"}, headers=auth(alex[1]), timeout=20).status_code == 422
    assert requests.post(f"{API}/challenges", json={"opponent_id": "x"}, timeout=20).status_code == 401


def test_challenge_create_duplicate_decline(alex, blair):
    _cancel_open(alex, blair)
    r = requests.post(f"{API}/challenges", json={"opponent_id": blair[0], "message": "TEST_ note"}, headers=auth(alex[1]), timeout=30)
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["status"] == "pending" and c["direction"] == "sent" and c["opponent"]["user_id"] == blair[0] and "emailed" in c
    # duplicate either direction
    assert requests.post(f"{API}/challenges", json={"opponent_id": blair[0]}, headers=auth(alex[1]), timeout=20).status_code == 409
    assert requests.post(f"{API}/challenges", json={"opponent_id": alex[0]}, headers=auth(blair[1]), timeout=20).status_code == 409
    # blair sees it as received + notification
    lst = requests.get(f"{API}/challenges", headers=auth(blair[1]), timeout=20).json()
    mine = next(x for x in lst if x["id"] == c["id"])
    assert mine["direction"] == "received" and mine["message"] == "TEST_ note"
    # result before accept -> 409; challenger can't respond -> 403
    assert requests.post(f"{BASE}/api/v1/challenges/{c['id']}/result", json={"score_text": "6-1 6-1", "i_won": True}, headers=auth(alex[1]), timeout=20).status_code == 409
    assert requests.post(f"{BASE}/api/v1/challenges/{c['id']}/respond", json={"action": "accept"}, headers=auth(alex[1]), timeout=20).status_code == 403
    # opponent can't cancel pending
    assert requests.post(f"{BASE}/api/v1/challenges/{c['id']}/cancel", headers=auth(blair[1]), timeout=20).status_code == 403
    d = requests.post(f"{BASE}/api/v1/challenges/{c['id']}/respond", json={"action": "decline"}, headers=auth(blair[1]), timeout=20)
    assert d.status_code == 200 and d.json()["status"] == "declined"
    assert requests.post(f"{BASE}/api/v1/challenges/{c['id']}/respond", json={"action": "accept"}, headers=auth(blair[1]), timeout=20).status_code == 409


def test_challenge_accept_then_cancel(alex, blair):
    r = requests.post(f"{API}/challenges", json={"opponent_id": blair[0]}, headers=auth(alex[1]), timeout=30)
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    a = requests.post(f"{BASE}/api/v1/challenges/{cid}/respond", json={"action": "accept"}, headers=auth(blair[1]), timeout=20)
    assert a.status_code == 200 and a.json()["status"] == "accepted"
    x = requests.post(f"{BASE}/api/v1/challenges/{cid}/cancel", headers=auth(blair[1]), timeout=20)
    assert x.status_code == 200 and x.json()["status"] == "cancelled"
    assert requests.post(f"{BASE}/api/v1/challenges/{cid}/cancel", headers=auth(alex[1]), timeout=20).status_code == 409


def test_challenge_unknown_404(alex):
    r = requests.post(f"{BASE}/api/v1/challenges/00000000-0000-0000-0000-000000000000/cancel", headers=auth(alex[1]), timeout=20)
    assert r.status_code == 404


# --- Head to head
def test_h2h_alex_blair(alex, blair):
    r = requests.get(f"{API}/head-to-head/{alex[0]}/{blair[0]}", headers=auth(alex[1]), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["a"]["user_id"] == alex[0] and d["b"]["user_id"] == blair[0]
    assert set(d["summary"]) == {"singles", "doubles"}
    for m in d["matches"]:
        assert m["kind"] in ("singles", "doubles")
        if m["a_change"]:
            assert abs(m["a_change"]["after"] - m["a_change"]["before"] - m["a_change"]["delta"]) < 0.01


def test_h2h_seeded_pair(alex):
    r = requests.get(f"{API}/head-to-head/player1/player2", headers=auth(alex[1]), timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    total = sum(v["a_wins"] + v["b_wins"] for v in d["summary"].values())
    assert total <= len(d["matches"])


def test_h2h_errors(alex):
    assert requests.get(f"{API}/head-to-head/{alex[0]}/{alex[0]}", headers=auth(alex[1]), timeout=20).status_code == 422
    assert requests.get(f"{API}/head-to-head/{alex[0]}/ghost", headers=auth(alex[1]), timeout=20).status_code == 404
    assert requests.get(f"{API}/head-to-head/{alex[0]}/player1", timeout=20).status_code == 401


# --- Monthly digest preference
def test_monthly_digest_pref_roundtrip(alex):
    me = requests.get(f"{API}/players/me", headers=auth(alex[1]), timeout=20).json()
    before = me["preferences"]["monthly_digest"]
    prof = me.get("profile", me)
    keys = ("display_name", "city", "state", "home_club", "image_url", "preferred_sport", "age_group", "gender_category", "visibility")
    body = {k: prof.get(k) for k in keys if prof.get(k) is not None}
    r = requests.put(f"{API}/players/me", json={**body, "monthly_digest": not before}, headers=auth(alex[1]), timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["preferences"]["monthly_digest"] is (not before)
    assert requests.get(f"{API}/players/me", headers=auth(alex[1]), timeout=20).json()["preferences"]["monthly_digest"] is (not before)
    requests.put(f"{API}/players/me", json={**body, "monthly_digest": before}, headers=auth(alex[1]), timeout=20)
