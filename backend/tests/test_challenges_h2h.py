"""Challenges from the fair match finder, head-to-head pages, admin email previews (dev-header server)."""
from test_rating_flow import club_with_players, report
from test_triace_flow import request, request_error


def test_challenge_accept_report_confirm_flow():
    owner, club_id, (a, b, c, _d) = club_with_players()
    sent = request("POST", f"/v1/clubs/{club_id}/challenges", a, json={"opponent_id": b, "message": "Saturday 9am?"})
    assert sent["status"] == "pending" and sent["direction"] == "sent" and sent["emailed"] is False
    assert request_error("POST", f"/v1/clubs/{club_id}/challenges", b, json={"opponent_id": a}).status_code == 409
    assert request_error("POST", f"/v1/clubs/{club_id}/challenges", a, json={"opponent_id": a}).status_code == 422
    received = request("GET", f"/v1/clubs/{club_id}/challenges", b)
    assert received[0]["direction"] == "received" and received[0]["opponent"]["user_id"] == a
    notes = request("GET", "/v1/notifications", b)
    assert any(n["kind"] == "challenge" and n["data"]["challengeId"] == sent["id"] for n in notes)
    assert request_error("POST", f"/v1/challenges/{sent['id']}/respond", a, json={"action": "accept"}).status_code == 403
    assert request_error("POST", f"/v1/challenges/{sent['id']}/respond", c, json={"action": "accept"}).status_code == 404
    assert request_error("POST", f"/v1/challenges/{sent['id']}/result", a, json={"score_text": "6-3 6-4"}).status_code == 409
    accepted = request("POST", f"/v1/challenges/{sent['id']}/respond", b, json={"action": "accept"})
    assert accepted["status"] == "accepted"
    done = request("POST", f"/v1/challenges/{sent['id']}/result", b, json={"score_text": "6-2 6-2"})
    assert done["status"] == "completed" and done["result_status"] == "reported"
    request("POST", f"/v1/match-results/{done['result_id']}/confirm", a)
    after = request("GET", f"/v1/clubs/{club_id}/challenges", a)[0]
    assert after["result_status"] == "finalized"
    h2h = request("GET", f"/v1/clubs/{club_id}/head-to-head/{a}/{b}", c)
    assert h2h["summary"]["singles"] == {"a_wins": 0, "b_wins": 1}
    m = h2h["matches"][0]
    assert m["a_won"] is False and m["a_change"]["delta"] < 0 < m["b_change"]["delta"]


def test_decline_and_cancel():
    _, club_id, (a, b, c, _d) = club_with_players()
    one = request("POST", f"/v1/clubs/{club_id}/challenges", a, json={"opponent_id": b})
    assert request("POST", f"/v1/challenges/{one['id']}/respond", b, json={"action": "decline"})["status"] == "declined"
    assert request_error("POST", f"/v1/challenges/{one['id']}/cancel", a).status_code == 409
    two = request("POST", f"/v1/clubs/{club_id}/challenges", a, json={"opponent_id": b})
    assert request_error("POST", f"/v1/challenges/{two['id']}/cancel", b).status_code == 403
    assert request("POST", f"/v1/challenges/{two['id']}/cancel", a)["status"] == "cancelled"


def test_head_to_head_hides_private_players():
    owner, club_id, (a, b, c, _d) = club_with_players()
    request("PUT", f"/v1/clubs/{club_id}/players/me", b, json={"display_name": "Hidden B", "visibility": "private"})
    r = report(club_id, a, [b])
    request("POST", f"/v1/match-results/{r['id']}/confirm", b)
    assert request_error("GET", f"/v1/clubs/{club_id}/head-to-head/{a}/{b}", c).status_code == 404
    assert request("GET", f"/v1/clubs/{club_id}/head-to-head/{a}/{b}", owner)["summary"]["singles"]["a_wins"] == 1
    assert request("GET", f"/v1/clubs/{club_id}/head-to-head/{a}/{b}", b)["summary"]["singles"]["a_wins"] == 1
    assert request_error("POST", f"/v1/clubs/{club_id}/challenges", c, json={"opponent_id": b}).status_code == 404


def test_email_previews_admin_only():
    owner, club_id, (a, b, *_rest) = club_with_players()
    r = report(club_id, a, [b])
    request("POST", f"/v1/match-results/{r['id']}/confirm", b)
    assert request_error("GET", f"/v1/clubs/{club_id}/emails/preview", a).status_code == 403
    weekly = request("GET", f"/v1/clubs/{club_id}/emails/preview?type=weekly&user_id={a}", owner)
    assert "WEEKLY RATING RECAP" in weekly["html"] and weekly["recipients"] == 0
    monthly = request("GET", f"/v1/clubs/{club_id}/emails/preview?type=monthly", owner)
    assert "MONTHLY LEADERBOARD" in monthly["html"] and "Biggest climbers" in monthly["html"] and "+" in monthly["html"]
    assert request_error("POST", f"/v1/clubs/{club_id}/emails/test", owner, json={"type": "monthly"}).status_code == 409
    saved = request("PUT", f"/v1/clubs/{club_id}/players/me", a, json={"display_name": "Player A", "monthly_digest": True})
    assert saved["preferences"]["monthly_digest"] is True
