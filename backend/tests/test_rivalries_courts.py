"""Court on challenges and the club rivalry leaderboard (dev-header server)."""
from test_rating_flow import club_with_players, report
from test_triace_flow import request


def play(club_id, winner, loser, times=1):
    for _ in range(times):
        r = report(club_id, winner, [loser])
        request("POST", f"/v1/match-results/{r['id']}/confirm", loser)


def test_court_is_kept_and_can_change_with_a_new_time():
    _, club_id, (a, b, *_rest) = club_with_players()
    ch = request("POST", f"/v1/clubs/{club_id}/challenges", a, json={"opponent_id": b, "court": " Court 3 ", "proposed_at": "2099-05-01T15:00:00Z"})
    assert ch["court"] == "Court 3"
    moved = request("POST", f"/v1/challenges/{ch['id']}/propose", b, json={"proposed_at": "2099-05-02T15:00:00Z", "court": "Court 5"})
    assert moved["court"] == "Court 5"
    request("POST", f"/v1/challenges/{ch['id']}/propose", a, json={"proposed_at": "2099-05-03T15:00:00Z"})
    assert request("GET", f"/v1/clubs/{club_id}/challenges", b)[0]["court"] == "Court 5"  # omitted court keeps the last one


def test_rivalry_board_lists_most_played_closest_and_one_sided():
    _, club_id, (a, b, c, d) = club_with_players()
    play(club_id, a, b, 2)
    play(club_id, b, a, 1)
    play(club_id, c, d, 2)
    play(club_id, a, c, 1)  # single meeting: not a rivalry
    board = request("GET", f"/v1/clubs/{club_id}/rivalries?kind=singles", a)
    top = board["most_played"][0]
    assert {top["a"]["user_id"], top["b"]["user_id"]} == {a, b} and top["meetings"] == 3 and (top["a_wins"], top["b_wins"]) == (2, 1)
    assert [(r["a_wins"], r["b_wins"]) for r in board["closest"]] == [(2, 1)]
    assert [(r["a"]["user_id"], r["b"]["user_id"], r["a_wins"], r["b_wins"]) for r in board["one_sided"]] == [(c, d, 2, 0)]
    assert len(board["most_played"]) == 2


def test_rivalry_board_hides_private_players():
    owner, club_id, (a, b, c, _d) = club_with_players()
    play(club_id, a, b, 2)
    request("PUT", f"/v1/clubs/{club_id}/players/me", b, json={"display_name": "Private B", "visibility": "private"})
    assert request("GET", f"/v1/clubs/{club_id}/rivalries", c)["most_played"] == []
    assert len(request("GET", f"/v1/clubs/{club_id}/rivalries", owner)["most_played"]) == 1
