"""Black-box API checks for TRIACE tiers, the three-team playoff and the challenge rule."""
import uuid
from datetime import datetime, timedelta, timezone

from test_triace_flow import request, request_error

NOW = datetime.now(timezone.utc)


def setup(prefix: str, team_count: int, division_rules: dict, rating: float = 5):
    owner = f"owner-{uuid.uuid4().hex[:8]}"
    suffix = uuid.uuid4().hex[:8]
    club_id = request("POST", "/v1/clubs", owner, json={"slug": f"{prefix}-{suffix}", "name": f"{prefix} club"})["id"]
    players = [f"p-{suffix}-{i}" for i in range(team_count * 3)]
    for player in players:
        request("POST", f"/v1/clubs/{club_id}/memberships", owner, json={"user_id": player, "display_name": player})
    event = request("POST", f"/v1/clubs/{club_id}/events", owner, json={"name": "TRIACE", "starts_at": NOW.isoformat(), "capacity": 48, "rules": {}})
    division = request("POST", f"/v1/events/{event['id']}/divisions", owner, json={"name": "Open", "format": "triace_team_round_robin", "capacity": 12, "rules": division_rules})
    request("POST", f"/v1/events/{event['id']}/publish", owner)
    return owner, club_id, event, division, players


def add_team(owner, club_id, division, players, index, rating=5, **extra):
    roster = players[index * 3: index * 3 + 3]
    body = {"division_id": division["id"], "name": f"Team {index + 1}", "members": [{"user_id": p, "rating": rating, "lineup_position": n + 1} for n, p in enumerate(roster)], **extra}
    team = request("POST", f"/v1/clubs/{club_id}/teams", roster[0], json=body)
    return request("POST", f"/v1/teams/{team['id']}/approve", owner)


def finalize(owner, fixture, players, home_wins=True):
    return request("POST", f"/v1/fixtures/{fixture['id']}/result", owner, json={
        "score_home": 3 if home_wins else 2, "score_away": 2 if home_wins else 3,
        "home_singles_player_ids": players[:2], "away_singles_player_ids": players[3:5],
    })


OFFICIAL = [
    {"id": "goat", "name": "GOAT Tier", "minRating": 17.5, "maxRating": 22.0, "order": 1, "active": True},
    {"id": "rising", "name": "Rising Tier", "minRating": 11.5, "maxRating": 17.0, "order": 2, "active": True},
]


def test_defaults_expose_the_official_tiers():
    defaults = request("GET", "/v1/triace/defaults", "anyone")
    assert [t["id"] for t in defaults["officialTiers"]] == ["goat", "rising"] and defaults["tiers"] == []
    assert defaults["playoffSize"] == 0 and defaults["challengeEnabled"] is False


def test_tier_placement_preferences_and_recalculation():
    owner, club_id, event, division, players = setup("tiers", 4, {"tiers": OFFICIAL})
    top = add_team(owner, club_id, division, players, 0, rating=6.0)            # 18.0 -> GOAT
    both = add_team(owner, club_id, division, players, 1, rating=6.0, selected_tier="both")
    low = add_team(owner, club_id, division, players, 2, rating=4.5)            # 13.5 -> Rising
    tiers = {t["team_name"]: t for t in request("GET", f"/v1/divisions/{division['id']}/tiers", owner)}
    assert tiers["Team 1"]["assigned_tier"] == "goat" and tiers["Team 1"]["listed_tiers"] == ["goat"]
    assert tiers["Team 2"]["listed_tiers"] == ["goat", "rising"]
    assert tiers["Team 3"]["assigned_tier"] == "rising"
    assert top["status"] and both["status"] and low["status"]

    # A low team cannot enter GOAT, a team between the bands cannot register, an unknown tier is refused.
    assert "does not qualify" in request_error("POST", f"/v1/clubs/{club_id}/teams", players[9], json={
        "division_id": division["id"], "name": "Too low", "selected_tier": "goat",
        "members": [{"user_id": p, "rating": 4.5, "lineup_position": n + 1} for n, p in enumerate(players[9:12])]}).text
    gap = request_error("POST", f"/v1/clubs/{club_id}/teams", players[9], json={
        "division_id": division["id"], "name": "Gap", "members": [{"user_id": p, "rating": 5.75, "lineup_position": n + 1} for n, p in enumerate(players[9:12])]})
    assert gap.status_code == 422  # 17.25 is between 17.00 and 17.50
    request_error("POST", f"/v1/clubs/{club_id}/teams", players[9], json={
        "division_id": division["id"], "name": "Nope", "selected_tier": "platinum", "members": [{"user_id": p, "rating": 6, "lineup_position": n + 1} for n, p in enumerate(players[9:12])]})

    # Raising the GOAT floor moves Team 1 and Team 2 out of GOAT on recalculation.
    raised = [{**OFFICIAL[0], "minRating": 19.0}, OFFICIAL[1]]
    request("PATCH", f"/v1/events/{event['id']}", owner, json={"rules": {"tiers": raised}, "audit_reason": "Raise GOAT floor"})
    summary = request("POST", f"/v1/divisions/{division['id']}/tiers/recalculate", owner)
    assert summary == {"reviewed": 3, "moved": 2, "unchanged": 1, "unassigned": 2}
    after = {t["team_name"]: t for t in request("GET", f"/v1/divisions/{division['id']}/tiers", owner)}
    assert after["Team 1"]["assigned_tier"] is None and after["Team 3"]["assigned_tier"] == "rising"


def test_three_team_playoff_is_chosen_automatically():
    owner, club_id, event, division, players = setup("elim", 3, {"teamMinRating": 12, "teamMaxRating": 22})
    teams = [add_team(owner, club_id, division, players, i) for i in range(3)]
    request("PATCH", f"/v1/events/{event['id']}", owner, json={"status": "closed", "audit_reason": "Registration ended"})
    games = request("POST", f"/v1/clubs/{club_id}/fixtures", owner, json={"division_id": division["id"], "home_team_id": teams[0]["id"], "away_team_id": teams[1]["id"], "starts_at": (NOW + timedelta(days=1)).isoformat()})
    finalize(owner, games, players)  # Team 1 beats Team 2, so Team 1 leads the table
    for home, away, hours in ((1, 2, 2), (0, 2, 3)):  # a team must have played to be playoff eligible
        extra = request("POST", f"/v1/clubs/{club_id}/fixtures", owner, json={"division_id": division["id"], "home_team_id": teams[home]["id"], "away_team_id": teams[away]["id"], "starts_at": (NOW + timedelta(days=hours)).isoformat()})
        request("POST", f"/v1/fixtures/{extra['id']}/result", owner, json={"score_home": 3, "score_away": 2, "home_singles_player_ids": players[home * 3: home * 3 + 2], "away_singles_player_ids": players[away * 3: away * 3 + 2]})
    bracket = request("POST", f"/v1/divisions/{division['id']}/playoffs/generate", owner, json={"starts_at": (NOW + timedelta(days=10)).isoformat()})
    assert [f["round_name"] for f in bracket] == ["playoff_eliminator"]
    seeds = request("GET", f"/v1/divisions/{division['id']}/playoff-seeds", owner)
    eliminator = bracket[0]
    assert {eliminator["home_team_id"], eliminator["away_team_id"]} == {seeds[1]["team_id"], seeds[2]["team_id"]}
    request_error("POST", f"/v1/divisions/{division['id']}/playoffs/generate", owner, json={"starts_at": (NOW + timedelta(days=10)).isoformat()})

    def full_encounter(fixture, home_wins):
        by_team = {t["id"]: players[i * 3: i * 3 + 3] for i, t in enumerate(teams)}
        h, a = by_team[fixture["home_team_id"]], by_team[fixture["away_team_id"]]
        shapes = [("singles", [h[0]], [a[0]]), ("singles", [h[1]], [a[1]]), ("doubles", [h[0], h[2]], [a[0], a[2]]), ("doubles", [h[1], h[2]], [a[1], a[2]]), ("super_tiebreak", [h[2]], [a[2]])]
        # Home wins 3-2 (singles and the tiebreak) or loses 2-3.
        scores = [(8, 5), (8, 5), (3, 4), (3, 4), (10, 8)] if home_wins else [(5, 8), (5, 8), (4, 3), (3, 4), (8, 10)]
        rubbers = [{"kind": k, "home_player_ids": hp, "away_player_ids": ap, "home_score": s[0], "away_score": s[1]} for (k, hp, ap), s in zip(shapes, scores, strict=True)]
        wins = sum(r["home_score"] > r["away_score"] for r in rubbers)
        return {"score_home": wins, "score_away": 5 - wins, "home_singles_player_ids": h[:2], "away_singles_player_ids": a[:2], "rubbers": rubbers}

    request("POST", f"/v1/fixtures/{eliminator['id']}/result", owner, json=full_encounter(eliminator, True))
    fixtures = request("GET", f"/v1/clubs/{club_id}/fixtures?division_id={division['id']}", owner)
    final = next(f for f in fixtures if f["round_name"] == "playoff_final")
    assert final["home_team_id"] == seeds[0]["team_id"] and final["away_team_id"] == eliminator["home_team_id"]
    request("POST", f"/v1/fixtures/{final['id']}/result", owner, json=full_encounter(final, True))
    assert request("GET", f"/v1/divisions/{division['id']}/champion", owner)["champion_team_id"] == seeds[0]["team_id"]


def test_challenge_rule_swaps_positions_on_a_win():
    owner, club_id, event, division, players = setup("chal", 6, {"teamMinRating": 12, "teamMaxRating": 22, "challengeEnabled": True})
    teams = [add_team(owner, club_id, division, players, i) for i in range(6)]
    for week in range(1, 6):  # five more scheduled weeks, so the challenge is made before the last three
        request("POST", f"/v1/clubs/{club_id}/fixtures", owner, json={"division_id": division["id"], "home_team_id": teams[0]["id"], "away_team_id": teams[1]["id"], "starts_at": (NOW + timedelta(days=7 * week)).isoformat()})
    start = (NOW + timedelta(days=2)).isoformat()
    path = f"/v1/divisions/{division['id']}/challenges"
    # With no results the table is alphabetical: Team 5 and 6 may challenge Team 2-4 only.
    request_error("POST", path, owner, json={"challenger_team_id": teams[3]["id"], "defender_team_id": teams[1]["id"], "starts_at": start})
    request_error("POST", path, owner, json={"challenger_team_id": teams[4]["id"], "defender_team_id": teams[0]["id"], "starts_at": start})
    challenge = request("POST", path, players[12], json={"challenger_team_id": teams[4]["id"], "defender_team_id": teams[1]["id"], "starts_at": start})
    assert challenge["round_name"] == "challenge"
    assert "once" in request_error("POST", path, owner, json={"challenger_team_id": teams[4]["id"], "defender_team_id": teams[2]["id"], "starts_at": start}).text
    finalize(owner, challenge, players[12:15] + players[3:6])  # challenger (home) wins
    order = [s["team_name"] for s in request("GET", f"/v1/divisions/{division['id']}/playoff-seeds", owner)]
    assert order == ["Team 1", "Team 5", "Team 3", "Team 4", "Team 2", "Team 6"]


def test_challenge_rule_is_off_unless_enabled():
    owner, club_id, event, division, players = setup("off", 6, {"teamMinRating": 12, "teamMaxRating": 22})
    teams = [add_team(owner, club_id, division, players, i) for i in range(6)]
    response = request_error("POST", f"/v1/divisions/{division['id']}/challenges", owner, json={"challenger_team_id": teams[4]["id"], "defender_team_id": teams[1]["id"], "starts_at": NOW.isoformat()})
    assert "not enabled" in response.text
