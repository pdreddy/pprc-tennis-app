"""Black-box API checks for PPRC Rating: reporting, confirmation, correction, privacy, rankings, tenancy."""
import uuid

from test_triace_flow import request, request_error


def club_with_players(count=4, start=6.0, visibility="club"):
    owner = f"owner-{uuid.uuid4().hex[:8]}"
    club = request("POST", "/v1/clubs", owner, json={"slug": f"rate-{uuid.uuid4().hex[:8]}", "name": "Rating Club"})
    players = [f"rp-{uuid.uuid4().hex[:6]}-{i}" for i in range(count)]
    for player in players:
        request("POST", f"/v1/clubs/{club['id']}/memberships", owner, json={"user_id": player, "display_name": player, "role": "player"})
        request("PUT", f"/v1/clubs/{club['id']}/players/me", player, json={"display_name": f"Player {player[-1]}", "city": "Prosper", "visibility": visibility, "starting_singles": start})
    return owner, club["id"], players


def report(club_id, player, opponents, score="6-3 6-4", **extra):
    return request("POST", f"/v1/clubs/{club_id}/match-results", player, json={"opponent_ids": opponents, "score_text": score, **extra})


def singles(club_id, user):
    return request("GET", f"/v1/clubs/{club_id}/players/me", user)["ratings"]["singles"]


def test_reported_result_is_rated_only_after_confirmation():
    _, club_id, (a, b, *_rest) = club_with_players()
    result = report(club_id, a, [b])
    assert result["status"] == "reported"
    assert singles(club_id, a)["verified_matches"] == 0
    request_error("POST", f"/v1/match-results/{result['id']}/confirm", a)  # reporter cannot confirm
    confirmed = request("POST", f"/v1/match-results/{result['id']}/confirm", b)
    assert confirmed["status"] == "finalized" and confirmed["rated"]
    after = singles(club_id, a)
    assert after["verified_matches"] == 1 and after["rating"] > 6 and after["provisional"]
    assert singles(club_id, b)["rating"] < 6


def test_disputed_result_is_not_rated_until_finalized():
    owner, club_id, (a, b, *_rest) = club_with_players()
    result = report(club_id, a, [b])
    request("POST", f"/v1/match-results/{result['id']}/dispute", b, json={"reason": "Score was 6-4 4-6 10-8"})
    assert singles(club_id, a)["verified_matches"] == 0
    request_error("POST", f"/v1/match-results/{result['id']}/finalize", a, json={"reason": "I am not staff"})
    request("POST", f"/v1/match-results/{result['id']}/finalize", owner, json={"score_text": "4-6 6-4 8-10", "reason": "Organizer reviewed the scorecard"})
    assert singles(club_id, b)["rating"] > 6 > singles(club_id, a)["rating"]


def test_correction_and_void_recalculate():
    owner, club_id, (a, b, *_rest) = club_with_players()
    result = report(club_id, a, [b])
    request("POST", f"/v1/match-results/{result['id']}/confirm", b)
    won = singles(club_id, a)["rating"]
    request("POST", f"/v1/match-results/{result['id']}/finalize", owner, json={"score_text": "3-6 4-6", "reason": "Players swapped sides on the card"})
    assert singles(club_id, a)["rating"] < 6 < won
    request("POST", f"/v1/match-results/{result['id']}/void", owner, json={"reason": "Match was a practice set"})
    reset = singles(club_id, a)
    assert reset["rating"] == 6 and reset["verified_matches"] == 0


def test_walkover_incomplete_and_no_score_do_not_move_ratings():
    _, club_id, (a, b, *_rest) = club_with_players()
    for extra in ({"outcome": "walkover", "winner_side": 1}, {"outcome": "incomplete", "score": "3-2"}, {"outcome": "no_score", "winner_side": 1}, {"outcome": "retired", "score": "3-1", "winner_side": 1}):
        score = extra.pop("score", None)
        result = request("POST", f"/v1/clubs/{club_id}/match-results", a, json={"opponent_ids": [b], "score_text": score, **extra})
        confirmed = request("POST", f"/v1/match-results/{result['id']}/confirm", b)
        assert confirmed["rated"] is False
    assert singles(club_id, a)["rating"] == 6 and singles(club_id, a)["verified_matches"] == 0


def test_doubles_tracked_separately_with_partner_history():
    _, club_id, (a, b, c, d) = club_with_players()
    result = report(club_id, a, [c, d], kind="doubles", partner_id=b)
    request("POST", f"/v1/match-results/{result['id']}/confirm", d)
    me = request("GET", f"/v1/clubs/{club_id}/players/me", a)
    assert me["ratings"]["doubles"]["verified_matches"] == 1 and me["ratings"]["singles"]["verified_matches"] == 0
    assert [p["user_id"] for p in me["doubles_partners"]] == [b]
    request_error("POST", f"/v1/clubs/{club_id}/match-results", a, json={"kind": "doubles", "opponent_ids": [c], "score_text": "6-1 6-1"})


def test_ranking_order_and_pagination():
    _, club_id, (a, b, c, d) = club_with_players()
    for winner, loser in ((a, b), (a, c), (b, c), (d, c)):
        result = report(club_id, winner, [loser])
        request("POST", f"/v1/match-results/{result['id']}/confirm", loser)
    page = request("GET", f"/v1/clubs/{club_id}/rankings?page_size=2", c)
    assert page["total"] == 4 and len(page["items"]) == 2 and page["items"][0]["user_id"] == a
    ratings = [row["rating"] for row in request("GET", f"/v1/clubs/{club_id}/rankings", c)["items"]]
    assert ratings == sorted(ratings, reverse=True)
    assert request("GET", f"/v1/clubs/{club_id}/rankings?include_provisional=false", c)["total"] == 0


def test_privacy_rules():
    owner, club_id, (a, b, *_rest) = club_with_players()
    request("PUT", f"/v1/clubs/{club_id}/players/me", b, json={"display_name": "Hidden B", "visibility": "private"})
    names = [p["user_id"] for p in request("GET", f"/v1/clubs/{club_id}/players", a)["items"]]
    assert b not in names
    request_error("GET", f"/v1/clubs/{club_id}/players/{b}", a)
    assert request("GET", f"/v1/clubs/{club_id}/players/{b}", owner)["profile"]["visibility"] == "private"
    request("PUT", f"/v1/clubs/{club_id}/players/me", a, json={"display_name": "Public A", "visibility": "public", "age_group": "Adult 35+"})
    club = next(c for c in request("GET", "/v1/clubs", owner) if c["id"] == club_id)
    public = request("GET", f"/v1/public/clubs/{club['slug']}/players/{a}", "anyone")
    assert "age_group" not in public["profile"] and "recent_matches" not in public


def test_tenant_isolation():
    _, club_one, (a, b, *_rest) = club_with_players()
    _, club_two, (x, *_others) = club_with_players()
    request_error("GET", f"/v1/clubs/{club_one}/rankings", x)
    request_error("GET", f"/v1/clubs/{club_one}/players/{a}", x)
    response = request_error("POST", f"/v1/clubs/{club_one}/match-results", a, json={"opponent_ids": [x], "score_text": "6-0 6-0"})
    assert response.status_code == 422  # opponent from another club
    result = report(club_one, a, [b])
    request_error("POST", f"/v1/match-results/{result['id']}/confirm", x)


def test_starting_rating_locks_after_first_verified_match():
    _, club_id, (a, b, *_rest) = club_with_players()
    result = report(club_id, a, [b])
    request("POST", f"/v1/match-results/{result['id']}/confirm", b)
    response = request_error("PUT", f"/v1/clubs/{club_id}/players/me", a, json={"display_name": "Player A", "starting_singles": 12})
    assert response.status_code == 409


def test_tournament_results_feed_ratings_and_walkovers_do_not():
    owner, club_id, players = club_with_players()
    event = request("POST", f"/v1/clubs/{club_id}/tournaments", owner, json={
        "event": {"name": "Rated cup", "starts_at": "2026-01-01T10:00:00+00:00", "capacity": 4, "rules": {}},
        "division": {"name": "Open", "format": "round_robin", "capacity": 4, "rules": {}},
    })
    division = next(d for d in request("GET", f"/v1/clubs/{club_id}/divisions", owner) if d["event_id"] == event["id"])
    request("POST", f"/v1/events/{event['id']}/publish", owner)
    for player in players:
        request("POST", f"/v1/divisions/{division['id']}/entries", owner, json={"user_id": player})
    matches = request("POST", f"/v1/divisions/{division['id']}/draw", owner, json={})
    request("POST", f"/v1/competition-matches/{matches[0]['id']}/result", owner, json={"score_one": 2, "score_two": 0, "score_text": "6-2 6-2"})
    request("POST", f"/v1/competition-matches/{matches[1]['id']}/walkover", owner, json={"winner_id": matches[1]["player_one_id"], "reason": "Opponent did not show"})
    winner = matches[0]["player_one_id"]
    assert singles(club_id, winner)["verified_matches"] == 1
    assert singles(club_id, matches[1]["player_one_id"])["verified_matches"] == (1 if matches[1]["player_one_id"] in {matches[0]["player_one_id"], matches[0]["player_two_id"]} else 0)


def test_reporter_cannot_partner_themselves():
    _, club_id, (a, _b, c, d) = club_with_players()
    response = request_error("POST", f"/v1/clubs/{club_id}/match-results", a, json={"kind": "doubles", "partner_id": a, "opponent_ids": [c, d], "score_text": "6-1 6-1"})
    assert response.status_code == 422


def test_private_players_are_anonymised_in_match_lists():
    owner, club_id, (a, b, c, _d) = club_with_players()
    request("PUT", f"/v1/clubs/{club_id}/players/me", b, json={"display_name": "Hidden B", "visibility": "private"})
    result = report(club_id, a, [b])
    request("POST", f"/v1/match-results/{result['id']}/confirm", b)
    seen_by_other = request("GET", f"/v1/clubs/{club_id}/players/{a}", c)["recent_matches"][0]
    assert seen_by_other["side_two"][0]["display_name"] == "Private player"
    seen_by_staff = request("GET", f"/v1/clubs/{club_id}/players/{a}", owner)["recent_matches"][0]
    assert seen_by_staff["side_two"][0]["user_id"] == b
