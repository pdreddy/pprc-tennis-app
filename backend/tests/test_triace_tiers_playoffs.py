"""DB-free tests for TRIACE tiers, automatic playoff size and the provisional challenge rule."""
import pytest

from app.triace_rules import (
    OFFICIAL_TIERS, RuleError, Tier, TriaceRules, apply_challenge_swaps, assign_selected_tier, assign_tier,
    challenge_problem, hundredths, listed_tiers, playoff_size_for,
)

T = OFFICIAL_TIERS  # GOAT 17.50-22.00, Rising 11.50-17.00


def test_official_bands_include_both_ends_and_leave_a_gap():
    assert assign_tier(hundredths(17.50), T) == "goat" and assign_tier(hundredths(22.00), T) == "goat"
    assert assign_tier(hundredths(17.00), T) == "rising" and assign_tier(hundredths(11.50), T) == "rising"
    assert assign_tier(hundredths(17.25), T) is None  # between the bands: cannot register
    assert assign_tier(hundredths(11.49), T) is None and assign_tier(hundredths(22.01), T) is None


def test_overlapping_bands_go_to_the_higher_order():
    tiers = (Tier("a", "A", 1000, 2000, 2), Tier("b", "B", 1500, 2500, 1))
    assert assign_tier(1700, tiers) == "b"


def test_inactive_tiers_are_ignored():
    tiers = (Tier("goat", "G", 1750, 2200, 1, active=False), Tier("rising", "R", 1150, 2200, 2))
    assert assign_tier(1800, tiers) == "rising"


@pytest.mark.parametrize("combined,selected,expected", [
    (1800, "higher", "goat"), (1800, "goat", "goat"), (1800, "rising", "rising"), (1800, "both", "goat"),
    (1400, "higher", "rising"), (1400, "rising", "rising"), (1400, "goat", None), (1400, "both", None),
    (1800, "nope", None), (1725, "higher", None),
])
def test_tier_preferences(combined, selected, expected):
    assert assign_selected_tier(combined, T, selected) == expected


def test_both_lists_a_top_team_in_the_top_two_tiers():
    assert listed_tiers(1800, T, "both") == ["goat", "rising"]
    assert listed_tiers(1800, T, "rising") == ["rising"]
    assert listed_tiers(1400, T, "both") == []


def test_tiers_round_trip_through_rule_dicts():
    rules = TriaceRules.resolve({"tiers": [t.as_dict() for t in T]}, {})
    assert rules.tiers == T and TriaceRules.resolve(rules.as_dict(), {}) == rules


@pytest.mark.parametrize("tiers", [
    [{"id": "a", "name": "A", "minRating": 10, "maxRating": 12, "order": 1}, {"id": "a", "name": "B", "minRating": 1, "maxRating": 2, "order": 2}],
    [{"id": "a", "name": "A", "minRating": 10, "maxRating": 12, "order": 1}, {"id": "b", "name": "B", "minRating": 1, "maxRating": 2, "order": 1}],
    [{"id": "higher", "name": "A", "minRating": 10, "maxRating": 12, "order": 1}],
    [{"id": "A!", "name": "A", "minRating": 10, "maxRating": 12, "order": 1}],
    [{"id": "a", "name": "A", "minRating": 12, "maxRating": 10, "order": 1}],
    [{"id": f"t{i}", "name": "T", "minRating": 1, "maxRating": 2, "order": i + 1} for i in range(21)],
    [{"id": "a", "name": "A"}],
])
def test_invalid_tier_configuration_is_rejected(tiers):
    with pytest.raises(RuleError):
        TriaceRules.resolve({"tiers": tiers}, {})


@pytest.mark.parametrize("configured,teams,expected", [(0, 8, 4), (0, 12, 4), (0, 7, 3), (0, 4, 3), (2, 12, 2), (4, 5, 4), (3, 12, 3)])
def test_playoff_size_follows_team_count_unless_configured(configured, teams, expected):
    assert playoff_size_for(configured, teams) == expected


def test_playoff_size_accepts_three_and_auto_but_not_five():
    assert TriaceRules.resolve({"playoffSize": 3}, {}).playoff_size == 3
    assert TriaceRules.resolve({"playoffSize": 0}, {}).playoff_size == 0
    with pytest.raises(RuleError):
        TriaceRules.resolve({"playoffSize": 5}, {})


# ---- challenge rule: positions are 1-based places in `order`
TABLE = ["t1", "t2", "t3", "t4", "t5", "t6"]
ON = TriaceRules.resolve({"challengeEnabled": True}, {})
OK = dict(previous_challenges=0, overdue_fixtures=0, weeks_left=6)


def problem(challenger, defender, rules=ON, **overrides):
    return challenge_problem(rules, TABLE, challenger, defender, **{**OK, **overrides})


def test_fifth_and_sixth_may_challenge_second_to_fourth():
    assert problem("t5", "t2") is None and problem("t6", "t4") is None and problem("t5", "t3") is None


def test_challenge_is_off_by_default():
    assert "not enabled" in problem("t5", "t2", rules=TriaceRules())


@pytest.mark.parametrize("challenger,defender", [("t5", "t1"), ("t4", "t2"), ("t5", "t6"), ("t6", "t5"), ("t2", "t5"), ("t5", "nobody")])
def test_only_fifth_or_sixth_can_challenge_second_to_fourth(challenger, defender):
    assert problem(challenger, defender) is not None


def test_each_team_challenges_only_once():
    assert "once" in problem("t5", "t2", previous_challenges=1)


def test_challenger_must_be_up_to_date_with_fixtures():
    assert "on time" in problem("t5", "t2", overdue_fixtures=1)


def test_challenge_must_come_before_the_last_three_weeks():
    assert problem("t5", "t2", weeks_left=4) is None
    assert "last 3 weeks" in problem("t5", "t2", weeks_left=3)


def test_a_win_swaps_positions_and_a_loss_changes_nothing():
    assert apply_challenge_swaps(TABLE, [("t5", "t2")]) == ["t1", "t5", "t3", "t4", "t2", "t6"]
    assert apply_challenge_swaps(TABLE, []) == TABLE


def test_swaps_apply_in_order():
    assert apply_challenge_swaps(TABLE, [("t5", "t2"), ("t6", "t5")]) == ["t1", "t6", "t3", "t4", "t2", "t5"]


def test_challenge_configuration_is_validated():
    with pytest.raises(RuleError):
        TriaceRules.resolve({"challengeChallengerPositions": [2], "challengeTargetPositions": [2]}, {})
    with pytest.raises(RuleError):
        TriaceRules.resolve({"challengeCutoffWeeks": -1}, {})
