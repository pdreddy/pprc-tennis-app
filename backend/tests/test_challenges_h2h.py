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


def test_h2h_score_from_player_a_and_voided_result_can_be_reported_again():
    owner, club_id, (a, b, *_rest) = club_with_players()
    ch = request("POST", f"/v1/clubs/{club_id}/challenges", a, json={"opponent_id": b})
    request("POST", f"/v1/challenges/{ch['id']}/respond", b, json={"action": "accept"})
    done = request("POST", f"/v1/challenges/{ch['id']}/result", b, json={"score_text": "6-3 7-6(4)"})
    request("POST", f"/v1/match-results/{done['result_id']}/void", owner, json={"reason": "Wrong score entered"})
    assert request("GET", f"/v1/clubs/{club_id}/challenges", a)[0]["result_status"] == "cancelled"
    again = request("POST", f"/v1/challenges/{ch['id']}/result", a, json={"score_text": "3-6 6-7(4)"})
    request("POST", f"/v1/match-results/{again['result_id']}/confirm", b)
    m = request("GET", f"/v1/clubs/{club_id}/head-to-head/{a}/{b}", a)["matches"][0]
    assert m["score_text"] == "3-6 6-7(4)" and m["a_won"] is False
    flipped = request("GET", f"/v1/clubs/{club_id}/head-to-head/{b}/{a}", a)["matches"][0]
    assert flipped["score_text"] == "6-3 7-6(4)" and flipped["a_won"] is True
    assert request_error("POST", f"/v1/challenges/{ch['id']}/result", a, json={"score_text": "6-0 6-0"}).status_code == 409
    request("POST", f"/v1/clubs/{club_id}/challenges", b, json={"opponent_id": a})  # completed one no longer blocks a new challenge


def test_time_can_go_back_and_forth_until_accepted():
    _, club_id, (a, b, *_rest) = club_with_players()
    ch = request("POST", f"/v1/clubs/{club_id}/challenges", a, json={"opponent_id": b})
    assert ch["awaiting_you"] is False and ch["expires_at"]
    assert request_error("POST", f"/v1/challenges/{ch['id']}/propose", a, json={"proposed_at": "2099-01-01T10:00:00Z"}).status_code == 403
    assert request_error("POST", f"/v1/challenges/{ch['id']}/propose", b, json={"proposed_at": "2001-01-01T10:00:00Z"}).status_code == 422
    countered = request("POST", f"/v1/challenges/{ch['id']}/propose", b, json={"proposed_at": "2099-01-02T10:00:00Z", "message": "Sunday?"})
    assert countered["awaiting_you"] is False
    mine = request("GET", f"/v1/clubs/{club_id}/challenges", a)[0]
    assert mine["awaiting_you"] is True and mine["proposed_at"].startswith("2099-01-02") and mine["message"] == "Sunday?"
    assert request_error("POST", f"/v1/challenges/{ch['id']}/respond", b, json={"action": "accept"}).status_code == 403
    request("POST", f"/v1/challenges/{ch['id']}/propose", a, json={"proposed_at": "2099-01-03T10:00:00Z"})
    assert request("POST", f"/v1/challenges/{ch['id']}/respond", b, json={"action": "accept"})["status"] == "accepted"
    assert any(n["title"].endswith("suggested another time") for n in request("GET", "/v1/notifications", a))


def test_challenge_settings_admin_only():
    owner, club_id, (a, *_rest) = club_with_players()
    assert request("GET", f"/v1/clubs/{club_id}/challenge-settings", a)["challenge_expiry_days"] == 7
    assert request_error("PUT", f"/v1/clubs/{club_id}/challenge-settings", a, json={"challenge_expiry_days": 5}).status_code == 403
    assert request_error("PUT", f"/v1/clubs/{club_id}/challenge-settings", owner, json={"challenge_expiry_days": 1}).status_code == 422
    assert request("PUT", f"/v1/clubs/{club_id}/challenge-settings", owner, json={"challenge_expiry_days": 4})["challenge_expiry_days"] == 4
    assert request("POST", f"/v1/clubs/{club_id}/challenges/maintenance", owner) == {"reminded": 0, "expired": 0}


def test_public_head_to_head_needs_two_public_profiles():
    import httpx
    from test_triace_flow import BASE_URL
    _, club_id, (a, b, *_rest) = club_with_players(visibility="public")
    r = report(club_id, a, [b])
    request("POST", f"/v1/match-results/{r['id']}/confirm", b)
    slug = next(c["slug"] for c in request("GET", "/v1/clubs", a) if c["id"] == club_id)
    ok = httpx.get(f"{BASE_URL}/v1/public/clubs/{slug}/head-to-head/{a}/{b}")
    assert ok.status_code == 200 and ok.json()["summary"]["singles"]["a_wins"] == 1
    request("PUT", f"/v1/clubs/{club_id}/players/me", b, json={"display_name": "Now Club", "visibility": "club"})
    assert httpx.get(f"{BASE_URL}/v1/public/clubs/{slug}/head-to-head/{a}/{b}").status_code == 404
