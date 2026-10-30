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
