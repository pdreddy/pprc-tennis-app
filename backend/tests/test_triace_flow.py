"""Black-box API verification against the Dockerized FastAPI service."""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")


def request(method: str, path: str, user: str, **kwargs):
    response = httpx.request(method, f"{BASE_URL}{path}", headers={"X-PPRC-User": user}, timeout=15, **kwargs)
    assert response.status_code < 400, response.text
    return response.json()


def test_triace_team_to_champion_flow():
    for _ in range(30):
        try:
            if httpx.get(f"{BASE_URL}/health", timeout=2).status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(1)
    else:
        raise AssertionError("FastAPI service did not become healthy")
    owner = f"owner-{uuid.uuid4().hex[:8]}"
    suffix = uuid.uuid4().hex[:8]
    club = request("POST", "/v1/clubs", owner, json={"slug": f"triace-{suffix}", "name": "TRIACE Test Club"})
    club_id = club["id"]

    players = [f"player-{suffix}-{index}" for index in range(12)]
    for player in players:
        request("POST", f"/v1/clubs/{club_id}/memberships", owner, json={"user_id": player, "display_name": player})

    event = request(
        "POST",
        f"/v1/clubs/{club_id}/events",
        owner,
        json={"name": "TRIACE 2.0", "starts_at": datetime.now(timezone.utc).isoformat(), "capacity": 24, "rules": {}},
    )
    division = request(
        "POST",
        f"/v1/events/{event['id']}/divisions",
        owner,
        json={"name": "Open", "format": "triace_team_round_robin", "capacity": 12, "rules": {"teamMinRating": 12, "teamMaxRating": 22, "minSinglesParticipationPct": 0.4}},
    )
    request("POST", f"/v1/events/{event['id']}/publish", owner)

    teams = []
    for index in range(4):
        roster = players[index * 3 : index * 3 + 3]
        team = request(
            "POST",
            f"/v1/clubs/{club_id}/teams",
            roster[0],
            json={"division_id": division["id"], "name": f"Team {index + 1}", "members": [{"user_id": player, "rating": 5, "lineup_position": position + 1} for position, player in enumerate(roster)]},
        )
        teams.append(request("POST", f"/v1/teams/{team['id']}/approve", owner))

    now = datetime.now(timezone.utc)

    def report(home_index: int, away_index: int, day_offset: int, home_players: list[str], away_players: list[str]):
        fixture = request(
            "POST",
            f"/v1/clubs/{club_id}/fixtures",
            owner,
            json={"division_id": division["id"], "home_team_id": teams[home_index]["id"], "away_team_id": teams[away_index]["id"], "starts_at": (now + timedelta(days=day_offset)).isoformat()},
        )
        return request(
            "POST",
            f"/v1/fixtures/{fixture['id']}/result",
            owner,
            json={"score_home": 3, "score_away": 2, "home_singles_player_ids": home_players, "away_singles_player_ids": away_players},
        )

    # Two match days let all three players satisfy the 40% singles eligibility rule.
    report(0, 1, 0, players[0:2], players[3:5])
    report(2, 3, 0, players[6:8], players[9:11])
    report(0, 2, 1, players[1:3], players[7:9])
    report(1, 3, 1, players[4:6], players[10:12])

    bracket = request("POST", f"/v1/divisions/{division['id']}/playoffs/generate", owner, json={"size": 2, "starts_at": (now + timedelta(days=10)).isoformat()})
    assert len(bracket) == 1
    final = bracket[0]
    final_home = next(team for team in teams if team["id"] == final["home_team_id"])
    final_away = next(team for team in teams if team["id"] == final["away_team_id"])
    home_roster = players[teams.index(final_home) * 3 : teams.index(final_home) * 3 + 2]
    away_roster = players[teams.index(final_away) * 3 : teams.index(final_away) * 3 + 2]
    request("POST", f"/v1/fixtures/{final['id']}/result", owner, json={"score_home": 3, "score_away": 1, "home_singles_player_ids": home_roster, "away_singles_player_ids": away_roster})
    champion = request("GET", f"/v1/divisions/{division['id']}/champion", owner)
    assert champion["champion_team_id"] == final_home["id"]
