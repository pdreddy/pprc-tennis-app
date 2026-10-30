"""DB-free unit tests for TRIACE rule validation (no running API required)."""
import pytest
from fastapi import HTTPException

from app.main import triace_rubber_detail, triace_rules_for
from app.models import Fixture
from app.schemas import FixtureResult

RULES = triace_rules_for({}, {})
HOME = {"h1": 1, "h2": 2, "h3": 3}
AWAY = {"a1": 1, "a2": 2, "a3": 3}


def rubber(kind, home, away, hs, a_s):
    return {"kind": kind, "home_player_ids": home, "away_player_ids": away, "home_score": hs, "away_score": a_s}


def result(rubbers, home=3, away=2):
    return FixtureResult(
        score_home=home, score_away=away,
        home_singles_player_ids=["h1", "h2"], away_singles_player_ids=["a1", "a2"],
        rubbers=rubbers,
    )


def fixture(round_name="regular"):
    return Fixture(round_name=round_name)


def full_set():
    return [
        rubber("singles", ["h1"], ["a1"], 8, 5),
        rubber("singles", ["h2"], ["a2"], 4, 8),
        rubber("doubles", ["h1", "h3"], ["a1", "a3"], 4, 3),
        rubber("doubles", ["h2", "h3"], ["a2", "a3"], 2, 4),
        rubber("super_tiebreak", ["h3"], ["a3"], 10, 8),
    ]


def test_rule_defaults():
    rules = triace_rules_for({}, {})
    assert (rules.team_min_rating, rules.team_max_rating, rules.min_singles_participation_pct, rules.playoff_size) == (12.0, 18.5, 0.4, 4)


@pytest.mark.parametrize("event,division", [({"teamSize": 1}, {}), ({}, {"teamMinRating": 20, "teamMaxRating": 10}), ({}, {"playoffSize": 3})])
def test_invalid_rules_rejected(event, division):
    with pytest.raises(HTTPException) as exc:
        triace_rules_for(event, division)
    assert exc.value.status_code == 422


def test_valid_full_set_is_accepted():
    detail = triace_rubber_detail(result(full_set()), fixture("playoff_final"), HOME, AWAY, RULES)
    assert len(detail["rubbers"]) == 5


def test_playoff_requires_rubbers():
    with pytest.raises(HTTPException):
        triace_rubber_detail(result([]), fixture("playoff_final"), HOME, AWAY, RULES)


def test_regular_without_rubbers_is_allowed():
    assert triace_rubber_detail(result([]), fixture(), HOME, AWAY, RULES) == {}


def test_totals_must_match_rubber_wins():
    with pytest.raises(HTTPException):
        triace_rubber_detail(result(full_set(), home=2, away=3), fixture("playoff_final"), HOME, AWAY, RULES)


def test_singles_must_use_p1_or_p2():
    rubbers = full_set()
    rubbers[0] = rubber("singles", ["h3"], ["a1"], 8, 5)
    with pytest.raises(HTTPException):
        triace_rubber_detail(result(rubbers), fixture("playoff_final"), HOME, AWAY, RULES)


def test_super_tiebreak_needs_ten():
    rubbers = full_set()
    rubbers[4] = rubber("super_tiebreak", ["h3"], ["a3"], 9, 7)
    with pytest.raises(HTTPException):
        triace_rubber_detail(result(rubbers), fixture("playoff_final"), HOME, AWAY, RULES)


def test_custom_encounter_format_is_enforced():
    # 1 singles + 1 doubles + 1 super tiebreak to 7, singles only by P3, doubles must be P1+P2.
    rules = triace_rules_for({"singlesMatches": 1, "doublesMatches": 1, "superTiebreakMatches": 1, "superTiebreakPoints": 7,
                              "singlesPositions": [3], "doublesPairs": [[1, 2]]}, {})
    rubbers = [
        rubber("singles", ["h3"], ["a3"], 6, 3),
        rubber("doubles", ["h1", "h2"], ["a1", "a2"], 6, 4),
        rubber("super_tiebreak", ["h3"], ["a3"], 7, 5),
    ]
    detail = triace_rubber_detail(result(rubbers, home=3, away=0), fixture("playoff_final"), HOME, AWAY, rules)
    assert len(detail["rubbers"]) == 3
    with pytest.raises(HTTPException):  # the default format is no longer accepted
        triace_rubber_detail(result(full_set()), fixture("playoff_final"), HOME, AWAY, rules)
