"""DB-free tests for configurable TRIACE rules."""
import pytest

from app.triace_rules import TRIACE_RULE_KEYS, RuleError, TriaceRules, validate_encounter


def test_defaults_match_original_triace():
    rules = TriaceRules.resolve({}, {})
    assert (rules.team_size, rules.rubber_counts, rules.wins_to_clinch) == (3, {"singles": 2, "doubles": 2, "super_tiebreak": 1}, 3)
    assert rules.team_min_rating == 12 and rules.team_max_rating == 18.5 and rules.playoff_size == 4


def test_division_overrides_event():
    rules = TriaceRules.resolve({"teamMinRating": 10, "playoffSize": 4}, {"playoffSize": 2})
    assert rules.team_min_rating == 10 and rules.playoff_size == 2


def test_round_trip_through_dict():
    custom = {"teamSize": 4, "singlesMatches": 3, "doublesMatches": 2, "superTiebreakMatches": 0, "singlesPositions": [1, 2, 3],
              "doublesPairs": [[1, 4], [2, 3]], "pointsPerWin": 2, "pointsPerLoss": 1, "teamMaxRating": 40}
    rules = TriaceRules.resolve(custom, {})
    assert TriaceRules.resolve(rules.as_dict(), {}) == rules
    assert set(rules.as_dict()) == set(TRIACE_RULE_KEYS)


@pytest.mark.parametrize("override", [
    {"teamSize": 1}, {"teamSize": 7}, {"singlesMatches": 1, "doublesMatches": 1, "superTiebreakMatches": 0},  # even total
    {"singlesMatches": 0, "doublesMatches": 0, "superTiebreakMatches": 0}, {"superTiebreakPoints": 3},
    {"singlesPositions": [1, 4]}, {"singlesPositions": []}, {"doublesPairs": [[1, 1]]}, {"doublesPairs": [[1, 5]]},
    {"teamMinRating": 30, "teamMaxRating": 20}, {"teamMaxRating": 61}, {"minSinglesParticipationPct": 0},
    {"playoffSize": 3}, {"pointsPerWin": 1, "pointsPerLoss": 2}, {"teamSize": "three"},
])
def test_invalid_rules_rejected(override):
    with pytest.raises(RuleError):
        TriaceRules.resolve(override, {})


def test_required_singles_days():
    assert TriaceRules.resolve({"minSinglesParticipationPct": 0.4}, {}).required_singles_days(5) == 2


HOME = {"h1": 1, "h2": 2, "h3": 3}
AWAY = {"a1": 1, "a2": 2, "a3": 3}


def r(kind, home, away, hs, a_s):
    return {"kind": kind, "home_player_ids": home, "away_player_ids": away, "home_score": hs, "away_score": a_s}


DEFAULT_SET = [
    r("singles", ["h1"], ["a1"], 8, 5), r("singles", ["h2"], ["a2"], 4, 8),
    r("doubles", ["h1", "h3"], ["a1", "a3"], 4, 3), r("doubles", ["h2", "h3"], ["a2", "a3"], 2, 4),
    r("super_tiebreak", ["h3"], ["a3"], 10, 8),
]


def test_default_encounter_accepted_and_playoff_requires_it():
    rules = TriaceRules()
    validate_encounter(DEFAULT_SET, 3, 2, True, HOME, AWAY, rules)
    with pytest.raises(RuleError):
        validate_encounter([], 3, 2, True, HOME, AWAY, rules)
    validate_encounter([], 3, 2, False, HOME, AWAY, rules)  # regular season may omit rubbers


def test_regular_season_can_require_rubbers():
    with pytest.raises(RuleError):
        validate_encounter([], 3, 2, False, HOME, AWAY, TriaceRules(require_rubbers_in_regular_season=True))


def test_custom_format_changes_what_is_valid():
    rules = TriaceRules(singles_matches=1, doubles_matches=1, super_tiebreak_matches=1, super_tiebreak_points=7,
                        singles_positions=(3,), doubles_pairs=((1, 2),))
    ok = [r("singles", ["h3"], ["a3"], 6, 3), r("doubles", ["h1", "h2"], ["a1", "a2"], 6, 4), r("super_tiebreak", ["h3"], ["a3"], 7, 5)]
    validate_encounter(ok, 3, 0, True, HOME, AWAY, rules)
    with pytest.raises(RuleError):
        validate_encounter(DEFAULT_SET, 3, 2, True, HOME, AWAY, rules)
    low = [*ok[:2], r("super_tiebreak", ["h3"], ["a3"], 6, 4)]
    with pytest.raises(RuleError):  # 6 < 7 points
        validate_encounter(low, 3, 0, True, HOME, AWAY, rules)


def test_totals_must_match():
    with pytest.raises(RuleError):
        validate_encounter(DEFAULT_SET, 2, 3, True, HOME, AWAY, TriaceRules())
