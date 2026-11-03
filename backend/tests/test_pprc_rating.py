from datetime import datetime, timedelta, timezone

from app.pprc_rating import (
    FORMULA_VERSION, MAX_RATING, MIN_RATING, PROVISIONAL_MATCHES, RatedInput, expected, is_rateable, parse_score, recency_weight, replay,
)

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def m(i, one, two, winner=1, games=(12, 7), fmt="best_of_3", kind="singles", days=0):
    return RatedInput(f"m{i:03}", kind, tuple(one), tuple(two), winner, games[0], games[1], fmt, T0 + timedelta(days=days))


def test_version_is_pinned():
    assert FORMULA_VERSION == "pprc-rating-1.0"


def test_parse_score_counts_games_and_match_tiebreak():
    assert parse_score("6-3 4-6 10-7") == (11, 9, 2, 1)
    assert parse_score("7-6 6-4") == (13, 10, 2, 0)
    assert parse_score("") is None and parse_score("W/O") is None


def test_expected_is_symmetric_and_favours_higher_rating():
    assert expected(8, 8) == 0.5
    assert round(expected(9, 6) + expected(6, 9), 10) == 1
    assert expected(9, 6) > 0.85


def test_upset_moves_more_than_expected_win():
    upset = replay({("a", "singles"): 5, ("b", "singles"): 9}, [m(1, ["a"], ["b"])])
    normal = replay({("a", "singles"): 9, ("b", "singles"): 5}, [m(1, ["a"], ["b"])])
    gain_upset = upset.states[("a", "singles")].rating - 5
    gain_normal = normal.states[("a", "singles")].rating - 9
    assert gain_upset > gain_normal >= 0


def test_score_margin_matters():
    close = replay({}, [m(1, ["a"], ["b"], games=(13, 12))]).states[("a", "singles")].rating
    rout = replay({}, [m(1, ["a"], ["b"], games=(12, 0))]).states[("a", "singles")].rating
    assert rout > close


def test_format_weight_and_recency():
    full = replay({}, [m(1, ["a"], ["b"])]).states[("a", "singles")].rating
    tiebreak = replay({}, [m(1, ["a"], ["b"], fmt="tiebreak")]).states[("a", "singles")].rating
    assert full > tiebreak
    assert recency_weight(T0, T0 + timedelta(days=400)) == 0.5 and recency_weight(T0, T0) == 1.0


def test_provisional_and_reliability_grow_with_matches():
    matches = [m(i, ["a"], [f"o{i}"], days=i) for i in range(PROVISIONAL_MATCHES)]
    state = replay({}, matches[:-1]).states[("a", "singles")]
    assert state.provisional and 0 < state.reliability < 100
    state = replay({}, matches).states[("a", "singles")]
    assert not state.provisional


def test_deterministic_and_order_independent_input():
    matches = [m(i, ["a"], ["b"], winner=1 + i % 2, days=i) for i in range(6)]
    one = replay({}, matches)
    two = replay({}, list(reversed(matches)))
    assert {k: v.rating for k, v in one.states.items()} == {k: v.rating for k, v in two.states.items()}


def test_bounds_are_enforced():
    top = replay({("a", "singles"): 16.45, ("b", "singles"): 1.0}, [m(i, ["a"], ["b"], games=(12, 0), days=i) for i in range(30)])
    assert top.states[("a", "singles")].rating <= MAX_RATING and top.states[("b", "singles")].rating >= MIN_RATING


def test_singles_and_doubles_are_separate():
    result = replay({}, [m(1, ["a", "b"], ["c", "d"], kind="doubles")])
    assert ("a", "doubles") in result.states and ("a", "singles") not in result.states
    assert result.states[("a", "doubles")].rating == result.states[("b", "doubles")].rating


def test_unrateable_outcomes():
    assert not is_rateable("walkover", 0, 0)
    assert not is_rateable("incomplete", 3, 2)
    assert not is_rateable("no_score", None, None)
    assert not is_rateable("retired", 3, 1)
    assert is_rateable("retired", 6, 3) and is_rateable("completed", 6, 4)
