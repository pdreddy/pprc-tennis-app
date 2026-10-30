"""DB-free tests for the pure tournament-format logic."""
import pytest

from app.formats import (
    elimination_round_name,
    elimination_rounds,
    ladder_after_win,
    round_robin_rounds,
    round_robin_table,
    seed_positions,
)


@pytest.mark.parametrize("count", [2, 3, 4, 5, 8])
def test_round_robin_plays_everyone_once(count):
    players = [f"p{i}" for i in range(count)]
    rounds = round_robin_rounds(players)
    pairs = [frozenset(pair) for matches in rounds for pair in matches]
    assert len(pairs) == len(set(pairs)) == count * (count - 1) // 2
    for matches in rounds:  # nobody plays twice in a round
        seen = [p for pair in matches for p in pair]
        assert len(seen) == len(set(seen))


def test_seed_positions():
    assert seed_positions(2) == [1, 2]
    assert seed_positions(8) == [1, 8, 4, 5, 2, 7, 3, 6]


def test_elimination_byes_go_to_top_seeds():
    rounds = elimination_rounds([f"p{i}" for i in range(1, 6)])
    assert [len(r) for r in rounds] == [4, 2, 1]
    first = rounds[0]
    assert ("p1", None) in first and ("p2", None) in first and ("p3", None) in first
    assert ("p4", "p5") in first


def test_elimination_needs_two_players():
    with pytest.raises(ValueError):
        elimination_rounds(["only"])


def test_round_names():
    assert [elimination_round_name(i, 3) for i in (1, 2, 3)] == ["quarterfinal", "semifinal", "final"]


def test_ladder_challenger_takes_rank_and_others_drop():
    assert ladder_after_win(list("abcde"), "d", "b") == list("adbce")


def test_ladder_defender_win_changes_nothing():
    assert ladder_after_win(list("abcde"), "b", "d") == list("abcde")


def test_table_orders_by_points_then_head_to_head():
    rows = round_robin_table(["a", "b", "c"], [("a", "b", "a"), ("b", "c", "b"), ("a", "c", "c")])
    assert [r["subject_id"] for r in rows][0] in {"a", "b", "c"}
    assert sum(r["played"] for r in rows) == 6
    two = round_robin_table(["x", "y"], [("x", "y", "y")], points_per_win=3)
    assert two[0]["subject_id"] == "y" and two[0]["points"] == 3


# ---- double elimination -------------------------------------------------------------------
from app.formats import DEAD, double_elimination_graph, settle_step, swiss_pairings, swiss_round_count


def simulate_double_elimination(count: int) -> str:
    """Play a full bracket in memory using the same graph and settle logic the API uses."""
    size = 1
    while size < count:
        size *= 2
    graph = double_elimination_graph(size)
    slots = [[None, None] for _ in graph]
    status = ["pending"] * len(graph)
    winners: dict[int, str] = {}
    players = [f"p{i}" for i in range(1, count + 1)]
    for pos, (a, b) in enumerate(elimination_rounds(players)[0]):
        slots[pos] = [a or DEAD, b or DEAD]

    def put(target, value):
        if target is not None:
            slots[target[0]][target[1]] = value

    def settle(i):
        if status[i] != "pending" or graph[i]["bracket"] in {"GR"}:
            return
        verdict, winner = settle_step(*slots[i])
        if verdict == "wait":
            return
        status[i] = verdict
        if verdict != "scheduled":
            winners[i] = winner
            put(graph[i]["winner_to"], winner)
            put(graph[i]["loser_to"], DEAD)
            for target in (graph[i]["winner_to"], graph[i]["loser_to"]):
                if target:
                    settle(target[0])

    for i in range(len(graph)):
        settle(i)
    grand = next(i for i, n in enumerate(graph) if n["bracket"] == "GF")
    reset = next(i for i, n in enumerate(graph) if n["bracket"] == "GR")
    progress = True
    while progress:
        progress = False
        for i, node in enumerate(graph):
            if status[i] != "scheduled" or node["bracket"] in {"GF", "GR"}:
                continue
            one, two = slots[i]
            win, lose = (one, two) if int(one[1:]) < int(two[1:]) else (two, one)  # lower number always wins
            status[i] = "finalized"
            winners[i] = win
            put(node["winner_to"], win)
            put(node["loser_to"], lose)
            for target in (node["winner_to"], node["loser_to"]):
                if target:
                    settle(target[0])
            progress = True
    assert status[grand] == "scheduled", f"{count}: grand final not ready"
    one, two = slots[grand]
    win = one if int(one[1:]) < int(two[1:]) else two
    if win == two:  # losers-bracket finalist won: play the reset
        slots[reset] = [one, two]
        win = one if int(one[1:]) < int(two[1:]) else two
    return win


@pytest.mark.parametrize("count", [2, 3, 4, 5, 6, 7, 8, 11, 16, 17, 24])
def test_double_elimination_completes_with_best_seed_champion(count):
    assert simulate_double_elimination(count) == "p1"


def test_double_elimination_graph_shape():
    graph = double_elimination_graph(8)
    counts = {}
    for node in graph:
        counts[node["bracket"]] = counts.get(node["bracket"], 0) + 1
    assert counts == {"W": 7, "L": 6, "GF": 1, "GR": 1}


def test_settle_step():
    assert settle_step("a", None) == ("wait", None)
    assert settle_step("a", DEAD) == ("bye", "a")
    assert settle_step(DEAD, DEAD)[0] == "dead"
    assert settle_step("a", "b") == ("scheduled", None)


# ---- swiss ---------------------------------------------------------------------------------
def test_swiss_round_count():
    assert [swiss_round_count(n) for n in (2, 4, 5, 8, 9)] == [1, 2, 3, 3, 4]


def test_swiss_avoids_rematches_and_gives_one_bye():
    order = ["a", "b", "c", "d", "e"]
    pairs, bye = swiss_pairings(order, {"a": 1, "b": 1}, {frozenset(("a", "b"))}, set())
    flat = [p for pair in pairs for p in pair] + [bye]
    assert sorted(flat) == order and bye == "e"
    assert frozenset(("a", "b")) not in {frozenset(p) for p in pairs}
    _, next_bye = swiss_pairings(order, {}, set(), {"e"})
    assert next_bye == "d"
