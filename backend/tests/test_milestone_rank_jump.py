"""Repro: a player who jumps straight into the top 3 / No.1 of a >10 field only gets 'Club top 10' (dev-header server)."""
import uuid

from test_triace_flow import request


def test_jump_to_no1_awards_no1_milestone():
    owner = f"owner-{uuid.uuid4().hex[:8]}"
    club = request("POST", "/v1/clubs", owner, json={"slug": f"jump-{uuid.uuid4().hex[:8]}", "name": "Jump Club"})
    cid = club["id"]
    players = [f"jp-{uuid.uuid4().hex[:6]}-{i}" for i in range(13)]
    for i, p in enumerate(players):
        request("POST", f"/v1/clubs/{cid}/memberships", owner, json={"user_id": p, "display_name": p, "role": "player"})
        request("PUT", f"/v1/clubs/{cid}/players/me", p, json={"display_name": f"P{i}", "city": "Prosper", "visibility": "club",
                                                                  "starting_singles": 9.0 if i == 0 else 6.0})
    star, others = players[0], players[1:]
    for a, b in zip(others[0::2], others[1::2], strict=False):  # 12 others -> 6 matches -> field of 12
        r = request("POST", f"/v1/clubs/{cid}/match-results", a, json={"opponent_ids": [b], "score_text": "6-3 6-4"})
        request("POST", f"/v1/match-results/{r['id']}/confirm", b)
    r = request("POST", f"/v1/clubs/{cid}/match-results", star, json={"opponent_ids": [others[1]], "score_text": "6-0 6-0"})
    request("POST", f"/v1/match-results/{r['id']}/confirm", others[1])
    me = request("GET", f"/v1/clubs/{cid}/players/me", star)
    ids = {m["id"] for m in me["milestones"]}
    print(me["milestones"])
    assert "singles-top1" in ids, f"Star is #1 of 13 but milestones are {ids}"
