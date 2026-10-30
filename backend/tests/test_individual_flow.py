"""Black-box API verification for round robin, single elimination and ladder tournaments."""
import uuid
from datetime import datetime, timezone

from test_triace_flow import request, request_error

NOW = datetime.now(timezone.utc).isoformat()


def make_tournament(owner: str, club_id: str, fmt: str, capacity: int = 8, rules: dict | None = None):
    event = request("POST", f"/v1/clubs/{club_id}/tournaments", owner, json={
        "event": {"name": f"{fmt} cup", "starts_at": NOW, "capacity": capacity, "rules": {}},
        "division": {"name": "Open", "format": fmt, "capacity": capacity, "rules": rules or {}},
    })
    divisions = request("GET", f"/v1/clubs/{event['club_id']}/divisions", owner)
    division = next(d for d in divisions if d["event_id"] == event["id"])
    request("POST", f"/v1/events/{event['id']}/publish", owner)
    return event, division


def setup():
    owner = f"owner-{uuid.uuid4().hex[:8]}"
    club = request("POST", "/v1/clubs", owner, json={"slug": f"ind-{uuid.uuid4().hex[:8]}", "name": "Individual Club"})
    return owner, club["id"]


def test_unknown_format_rejected():
    owner, club_id = setup()
    response = request_error("POST", f"/v1/clubs/{club_id}/tournaments", owner, json={
        "event": {"name": "x cup", "starts_at": NOW}, "division": {"name": "Open", "format": "swiss"},
    })
    assert response.status_code == 422


def test_round_robin_standings():
    owner, club_id = setup()
    _, division = make_tournament(owner, club_id, "round_robin")
    players = [f"rr-{uuid.uuid4().hex[:6]}-{i}" for i in range(4)]
    for player in players:
        request("POST", f"/v1/divisions/{division['id']}/entries", owner, json={"user_id": player})
    matches = request("POST", f"/v1/divisions/{division['id']}/draw", owner, json={})
    assert len(matches) == 6
    request_error("POST", f"/v1/divisions/{division['id']}/draw", owner, json={})
    for match in matches:  # player_one always wins
        request("POST", f"/v1/competition-matches/{match['id']}/result", owner, json={"score_one": 6, "score_two": 3})
    table = request("GET", f"/v1/divisions/{division['id']}/player-standings", owner)
    assert sum(row["wins"] for row in table) == 6 and all(row["played"] == 3 for row in table)


def test_single_elimination_with_bye_reaches_final():
    owner, club_id = setup()
    _, division = make_tournament(owner, club_id, "single_elimination")
    players = [f"se-{uuid.uuid4().hex[:6]}-{i}" for i in range(5)]
    for seed, player in enumerate(players, start=1):
        request("POST", f"/v1/divisions/{division['id']}/entries", owner, json={"user_id": player, "seed": seed})
    request("POST", f"/v1/divisions/{division['id']}/draw", owner, json={})
    for _ in range(3):  # play every ready match until the final is decided
        matches = request("GET", f"/v1/divisions/{division['id']}/competition-matches", owner)
        for match in matches:
            if match["status"] == "scheduled":
                request("POST", f"/v1/competition-matches/{match['id']}/result", owner, json={"score_one": 6, "score_two": 2})
    matches = request("GET", f"/v1/divisions/{division['id']}/competition-matches", owner)
    final = next(m for m in matches if m["round_name"] == "final")
    assert final["status"] == "finalized" and final["winner_id"] == players[0]


def test_ladder_challenge_moves_ranks():
    owner, club_id = setup()
    _, division = make_tournament(owner, club_id, "ladder", rules={"challengeRange": 2})
    players = [f"ld-{uuid.uuid4().hex[:6]}-{i}" for i in range(4)]
    for player in players:
        request("POST", f"/v1/divisions/{division['id']}/entries", owner, json={"user_id": player})
    request_error("POST", f"/v1/divisions/{division['id']}/ladder/challenges", players[3], json={"opponent_id": players[0]})  # out of range
    challenge = request("POST", f"/v1/divisions/{division['id']}/ladder/challenges", players[3], json={"opponent_id": players[1]})
    reported = request("POST", f"/v1/competition-matches/{challenge['id']}/result", players[3], json={"score_one": 6, "score_two": 4})
    assert reported["status"] == "reported"
    request_error("POST", f"/v1/competition-matches/{challenge['id']}/confirm", players[3])
    request("POST", f"/v1/competition-matches/{challenge['id']}/confirm", players[1])
    ladder = request("GET", f"/v1/divisions/{division['id']}/entries", owner)
    assert [e["user_id"] for e in ladder if e["status"] == "active"] == [players[0], players[3], players[1], players[2]]


def play_all_ready(owner: str, division_id: str, limit: int = 12):
    for _ in range(limit):
        ready = [m for m in request("GET", f"/v1/divisions/{division_id}/competition-matches", owner) if m["status"] == "scheduled"]
        if not ready:
            return
        for match in ready:
            request("POST", f"/v1/competition-matches/{match['id']}/result", owner, json={"score_one": 6, "score_two": 1})


def test_double_elimination_runs_to_grand_final():
    owner, club_id = setup()
    _, division = make_tournament(owner, club_id, "double_elimination")
    players = [f"de-{uuid.uuid4().hex[:6]}-{i}" for i in range(5)]
    for seed, player in enumerate(players, start=1):
        request("POST", f"/v1/divisions/{division['id']}/entries", owner, json={"user_id": player, "seed": seed})
    request("POST", f"/v1/divisions/{division['id']}/draw", owner, json={})
    play_all_ready(owner, division["id"])
    matches = request("GET", f"/v1/divisions/{division['id']}/competition-matches", owner)
    final = next(m for m in matches if m["round_name"] == "grand_final")
    assert final["status"] == "finalized" and final["winner_id"] == players[0]
    assert not [m for m in matches if m["status"] in {"scheduled", "reported", "pending"} and m["round_name"] != "grand_final_reset"]


def test_swiss_generates_rounds_without_rematches():
    owner, club_id = setup()
    _, division = make_tournament(owner, club_id, "swiss")
    players = [f"sw-{uuid.uuid4().hex[:6]}-{i}" for i in range(4)]
    for player in players:
        request("POST", f"/v1/divisions/{division['id']}/entries", owner, json={"user_id": player})
    first = request("POST", f"/v1/divisions/{division['id']}/draw", owner, json={})
    assert len(first) == 2
    request_error("POST", f"/v1/divisions/{division['id']}/swiss/next-round", owner, json={})  # round 1 unfinished
    play_all_ready(owner, division["id"], 1)
    second = request("POST", f"/v1/divisions/{division['id']}/swiss/next-round", owner, json={})
    seen = {frozenset((m["player_one_id"], m["player_two_id"])) for m in first}
    assert all(frozenset((m["player_one_id"], m["player_two_id"])) not in seen for m in second)
    play_all_ready(owner, division["id"], 1)
    assert request_error("POST", f"/v1/divisions/{division['id']}/swiss/next-round", owner, json={}).status_code == 409


def test_late_withdrawal_awards_walkovers_and_manual_walkover():
    owner, club_id = setup()
    _, division = make_tournament(owner, club_id, "round_robin")
    players = [f"wo-{uuid.uuid4().hex[:6]}-{i}" for i in range(4)]
    for player in players:
        request("POST", f"/v1/divisions/{division['id']}/entries", owner, json={"user_id": player})
    request("POST", f"/v1/divisions/{division['id']}/draw", owner, json={})
    entries = request("GET", f"/v1/divisions/{division['id']}/entries", owner)
    leaving = next(e for e in entries if e["user_id"] == players[3])
    request("POST", f"/v1/entries/{leaving['id']}/withdraw", owner)
    after = request("GET", f"/v1/divisions/{division['id']}/competition-matches", owner)
    involving = [m for m in after if players[3] in {m["player_one_id"], m["player_two_id"]}]
    assert len(involving) == 3 and all(m["status"] == "finalized" and m["winner_id"] != players[3] for m in involving)
    remaining = next(m for m in after if m["status"] == "scheduled")
    request("POST", f"/v1/competition-matches/{remaining['id']}/walkover", owner, json={"winner_id": remaining["player_one_id"], "reason": "Opponent no-show"})


def test_doubles_entries_need_a_partner_and_partner_can_report():
    owner, club_id = setup()
    _, division = make_tournament(owner, club_id, "round_robin", rules={"entryType": "doubles"})
    tag = uuid.uuid4().hex[:6]
    a1, a2, b1, b2 = (f"db-{tag}-{i}" for i in range(4))
    request_error("POST", f"/v1/divisions/{division['id']}/entries", owner, json={"user_id": a1})
    request("POST", f"/v1/divisions/{division['id']}/entries", owner, json={"user_id": a1, "partner_user_id": a2})
    request("POST", f"/v1/divisions/{division['id']}/entries", owner, json={"user_id": b1, "partner_user_id": b2})
    request_error("POST", f"/v1/divisions/{division['id']}/entries", owner, json={"user_id": f"x-{tag}", "partner_user_id": a2})  # partner already entered
    match = request("POST", f"/v1/divisions/{division['id']}/draw", owner, json={})[0]
    reported = request("POST", f"/v1/competition-matches/{match['id']}/result", a2, json={"score_one": 6, "score_two": 2})
    assert reported["status"] == "reported"
    request_error("POST", f"/v1/competition-matches/{match['id']}/confirm", a1)  # same side
    assert request("POST", f"/v1/competition-matches/{match['id']}/confirm", b2)["status"] == "finalized"


def test_groups_knockout_snake_draw_then_bracket():
    owner, club_id = setup()
    _, division = make_tournament(owner, club_id, "groups_knockout", rules={"groupSize": 4, "advancePerGroup": 2})
    players = [f"gk-{uuid.uuid4().hex[:6]}-{i}" for i in range(8)]
    for seed, player in enumerate(players, start=1):
        request("POST", f"/v1/divisions/{division['id']}/entries", owner, json={"user_id": player, "seed": seed})
    matches = request("POST", f"/v1/divisions/{division['id']}/draw", owner, json={})
    assert len(matches) == 12 and {m["round_name"] for m in matches} == {"group_A", "group_B"}
    entries = {e["user_id"]: e["group_label"] for e in request("GET", f"/v1/divisions/{division['id']}/entries", owner)}
    assert [entries[p] for p in players] == ["A", "B", "B", "A", "A", "B", "B", "A"]  # snake: 1->A, 2->B, 3->B, 4->A ...
    request_error("POST", f"/v1/divisions/{division['id']}/groups/advance", owner, json={})  # group play unfinished
    play_all_ready(owner, division["id"])
    bracket = request("POST", f"/v1/divisions/{division['id']}/groups/advance", owner, json={})
    assert {m["round_name"] for m in bracket} == {"semifinal", "final"}
    request_error("POST", f"/v1/divisions/{division['id']}/groups/advance", owner, json={})
    play_all_ready(owner, division["id"])
    final = next(m for m in request("GET", f"/v1/divisions/{division['id']}/competition-matches", owner) if m["round_name"] == "final")
    assert final["status"] == "finalized"
    table = request("GET", f"/v1/divisions/{division['id']}/player-standings", owner)
    assert {row["group"] for row in table} == {"A", "B"}
