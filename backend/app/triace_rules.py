"""Every TRIACE property as validated, organizer-configurable rules (pure; no database access)."""
import re
from dataclasses import dataclass
from math import floor


class RuleError(ValueError):
    """A TRIACE rule value is invalid."""


@dataclass(frozen=True)
class Tier:
    """A named combined-rating band. Ratings are stored as integer hundredths so band edges are exact."""
    id: str
    name: str
    min_rating: int
    max_rating: int
    order: int  # 1 is the highest tier and wins where bands overlap
    active: bool = True

    def as_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "minRating": self.min_rating / 100, "maxRating": self.max_rating / 100, "order": self.order, "active": self.active}


# Triace 2.0 rules page: GOAT 17.50-22.00, Rising 11.50-17.00 (both ends inclusive).
OFFICIAL_TIERS = (Tier("goat", "GOAT Tier", 1750, 2200, 1), Tier("rising", "Rising Tier", 1150, 1700, 2))
TIER_ID = re.compile(r"^[a-z][a-z0-9_-]{0,39}$")
RESERVED_TIER_IDS = {"higher", "both"}


def hundredths(value: float) -> int:
    return round(float(value) * 100)


def validate_tiers(tiers: tuple[Tier, ...]) -> None:
    if len(tiers) > 20:
        raise RuleError("A division supports at most 20 tiers")
    if len({t.id for t in tiers}) != len(tiers):
        raise RuleError("Tier ids must be unique")
    if len({t.order for t in tiers}) != len(tiers):
        raise RuleError("Each tier needs a unique order (1 is the highest)")
    for t in tiers:
        if not TIER_ID.match(t.id) or t.id in RESERVED_TIER_IDS:
            raise RuleError(f"Tier id '{t.id}' must be lowercase letters, numbers, hyphens or underscores, and cannot be 'higher' or 'both'")
        if not t.name.strip() or len(t.name) > 50:
            raise RuleError("Tier names are required (up to 50 characters)")
        if not 1 <= t.order <= 999:
            raise RuleError("Tier order must be between 1 and 999")
        if not 1 <= t.min_rating <= t.max_rating <= 12000:
            raise RuleError("Tier rating limits must satisfy 0.01 <= minimum <= maximum <= 120")


def ordered_tiers(tiers: tuple[Tier, ...], active_only: bool = True) -> list[Tier]:
    return sorted((t for t in tiers if t.active or not active_only), key=lambda t: (t.order, t.id))


def assign_tier(combined: int, tiers: tuple[Tier, ...]) -> str | None:
    """Highest active tier whose band contains the combined rating (hundredths), or None."""
    return next((t.id for t in ordered_tiers(tiers) if t.min_rating <= combined <= t.max_rating), None)


def assign_selected_tier(combined: int, tiers: tuple[Tier, ...], selected: str = "higher") -> str | None:
    """Tier the team is placed in for its preference: a tier id, 'higher' (highest eligible) or 'both'.

    A team may only enter its own tier or a lower one; 'both' lists a team qualified for the top tier in the top two."""
    highest = assign_tier(combined, tiers)
    if highest is None:
        return None
    if selected == "higher":
        return highest
    active = ordered_tiers(tiers)
    ids = [t.id for t in active]
    if selected == "both":
        return highest if highest == ids[0] and len(ids) > 1 else None
    if selected not in ids:
        return None
    return selected if ids.index(selected) >= ids.index(highest) else None


def listed_tiers(combined: int, tiers: tuple[Tier, ...], selected: str = "higher") -> list[str]:
    assigned = assign_selected_tier(combined, tiers, selected)
    if assigned is None:
        return []
    if selected == "both":
        return [t.id for t in ordered_tiers(tiers)[:2]]
    return [assigned]


def playoff_size_for(configured: int, team_count: int) -> int:
    """Teams that qualify: the configured size, or (0 = automatic) the top 4 for more than 7 teams and the top 3 otherwise."""
    return configured or (4 if team_count > 7 else 3)


def apply_challenge_swaps(order: list, swaps: list[tuple]) -> list:
    """Exchange table positions for each (challenger, defender) pair the challenger won, oldest first."""
    result = list(order)
    for challenger, defender in swaps:
        if challenger in result and defender in result:
            i, j = result.index(challenger), result.index(defender)
            result[i], result[j] = result[j], result[i]
    return result


def challenge_problem(rules: "TriaceRules", order: list, challenger, defender, *, previous_challenges: int, overdue_fixtures: int, weeks_left: int) -> str | None:
    """Why this challenge is not allowed, or None. `order` is the current table, best first."""
    if not rules.challenge_enabled:
        return "The challenge rule is not enabled for this division"
    if challenger not in order or defender not in order:
        return "Both teams must be in the division table"
    place, target = order.index(challenger) + 1, order.index(defender) + 1
    if place not in rules.challenge_challenger_positions:
        return "Only teams in the configured challenger positions can challenge"
    if target not in rules.challenge_target_positions:
        return "That position cannot be challenged"
    if previous_challenges:
        return "Each team can use its challenge only once"
    if overdue_fixtures:
        return "The challenger must have completed all scheduled weeks on time"
    if weeks_left <= rules.challenge_cutoff_weeks:
        return f"Challenges must be made before the last {rules.challenge_cutoff_weeks} weeks of the season"
    return None


@dataclass(frozen=True)
class TriaceRules:
    team_size: int = 3
    singles_matches: int = 2
    doubles_matches: int = 2
    super_tiebreak_matches: int = 1
    super_tiebreak_points: int = 10
    singles_positions: tuple[int, ...] = (1, 2, 3)  # any two of the three players may play singles on a match day
    doubles_pairs: tuple[tuple[int, int], ...] = ((1, 3), (2, 3))
    team_min_rating: float = 12.0
    team_max_rating: float = 18.5
    player_max_rating: float = 20.0
    min_singles_participation_pct: float = 0.4
    playoff_size: int = 0  # 0 = automatic: top 4 for more than 7 teams, otherwise top 3
    points_per_win: int = 3
    points_per_loss: int = 0
    require_rubbers_in_regular_season: bool = False
    # Empty = no tiers: only the combined-rating window above applies. Use OFFICIAL_TIERS for Triace 2.0.
    tiers: tuple[Tier, ...] = ()
    # Provisional challenge rule (off by default): teams in the challenger positions may challenge once, before the cut-off.
    challenge_enabled: bool = False
    challenge_challenger_positions: tuple[int, ...] = (5, 6)
    challenge_target_positions: tuple[int, ...] = (2, 3, 4)
    challenge_cutoff_weeks: int = 3
    require_consent: bool = False  # registration needs the player-consent and rules-accepted flags
    ace_name_masking: bool = True  # public lists hide player names unless an organizer turns this off (and the team consented)

    # ---- construction -------------------------------------------------------------------
    @classmethod
    def resolve(cls, event_rules: dict | None, division_rules: dict | None) -> "TriaceRules":
        """Division values override event values; anything unset falls back to the TRIACE defaults."""
        merged = {**(event_rules or {}), **(division_rules or {})}
        defaults = cls()
        try:
            rules = cls(
                team_size=int(merged.get("teamSize", defaults.team_size)),
                singles_matches=int(merged.get("singlesMatches", defaults.singles_matches)),
                doubles_matches=int(merged.get("doublesMatches", defaults.doubles_matches)),
                super_tiebreak_matches=int(merged.get("superTiebreakMatches", defaults.super_tiebreak_matches)),
                super_tiebreak_points=int(merged.get("superTiebreakPoints", defaults.super_tiebreak_points)),
                singles_positions=tuple(int(v) for v in merged.get("singlesPositions", defaults.singles_positions)),
                doubles_pairs=tuple(tuple(int(v) for v in pair) for pair in merged.get("doublesPairs", defaults.doubles_pairs)),
                team_min_rating=float(merged.get("teamMinRating", defaults.team_min_rating)),
                team_max_rating=float(merged.get("teamMaxRating", defaults.team_max_rating)),
                player_max_rating=float(merged.get("playerMaxRating", defaults.player_max_rating)),
                min_singles_participation_pct=float(merged.get("minSinglesParticipationPct", defaults.min_singles_participation_pct)),
                playoff_size=int(merged.get("playoffSize", defaults.playoff_size)),
                points_per_win=int(merged.get("pointsPerWin", defaults.points_per_win)),
                points_per_loss=int(merged.get("pointsPerLoss", defaults.points_per_loss)),
                require_rubbers_in_regular_season=bool(merged.get("requireRubbersInRegularSeason", defaults.require_rubbers_in_regular_season)),
                tiers=tuple(
                    Tier(str(t["id"]), str(t["name"]), hundredths(t["minRating"]), hundredths(t["maxRating"]), int(t["order"]), bool(t.get("active", True)))
                    for t in merged.get("tiers", ())
                ),
                challenge_enabled=bool(merged.get("challengeEnabled", defaults.challenge_enabled)),
                challenge_challenger_positions=tuple(int(v) for v in merged.get("challengeChallengerPositions", defaults.challenge_challenger_positions)),
                challenge_target_positions=tuple(int(v) for v in merged.get("challengeTargetPositions", defaults.challenge_target_positions)),
                challenge_cutoff_weeks=int(merged.get("challengeCutoffWeeks", defaults.challenge_cutoff_weeks)),
                require_consent=bool(merged.get("requireConsent", defaults.require_consent)),
                ace_name_masking=bool(merged.get("aceNameMaskingEnabled", defaults.ace_name_masking)),
            )
        except (TypeError, ValueError, KeyError, AttributeError) as exc:
            raise RuleError("TRIACE rules contain a value of the wrong type") from exc
        rules.validate()
        return rules

    def validate(self) -> None:
        if not 2 <= self.team_size <= 6:
            raise RuleError("Team size must be between 2 and 6 players")
        for label, count in (("singles", self.singles_matches), ("doubles", self.doubles_matches), ("super tiebreak", self.super_tiebreak_matches)):
            if not 0 <= count <= 6:
                raise RuleError(f"Number of {label} matches must be between 0 and 6")
        if self.rubber_total < 1:
            raise RuleError("An encounter needs at least one match")
        if self.rubber_total % 2 == 0:
            raise RuleError("The total number of matches per encounter must be odd so an encounter cannot tie")
        if not 5 <= self.super_tiebreak_points <= 21:
            raise RuleError("Super tiebreak points must be between 5 and 21")
        positions = set(range(1, self.team_size + 1))
        if self.singles_matches and not self.singles_positions:
            raise RuleError("Choose which lineup positions may play singles")
        if not set(self.singles_positions) <= positions or len(set(self.singles_positions)) != len(self.singles_positions):
            raise RuleError(f"Singles positions must be distinct values between 1 and {self.team_size}")
        if (self.doubles_matches or self.super_tiebreak_matches) and not self.doubles_pairs:
            raise RuleError("Choose which lineup positions may pair for doubles")
        for pair in self.doubles_pairs:
            if len(pair) != 2 or pair[0] == pair[1] or not set(pair) <= positions:
                raise RuleError(f"Doubles pairs must be two different positions between 1 and {self.team_size}")
        if not 1 <= self.player_max_rating <= 20:
            raise RuleError("Player maximum rating must be between 1 and 20")
        ceiling = self.team_size * self.player_max_rating
        if not 0 <= self.team_min_rating <= self.team_max_rating <= ceiling:
            raise RuleError(f"Combined rating bounds must satisfy 0 <= minimum <= maximum <= {ceiling:g}")
        if not 0 < self.min_singles_participation_pct <= 1:
            raise RuleError("Singles participation percentage must be greater than 0 and at most 100%")
        if self.playoff_size not in {0, 2, 3, 4}:
            raise RuleError("TRIACE playoffs support two, three or four teams (0 chooses automatically)")
        validate_tiers(self.tiers)
        if self.challenge_cutoff_weeks < 0 or any(p < 1 for p in (*self.challenge_challenger_positions, *self.challenge_target_positions)):
            raise RuleError("Challenge positions must be 1 or higher and the cut-off cannot be negative")
        if set(self.challenge_challenger_positions) & set(self.challenge_target_positions):
            raise RuleError("A table position cannot be both a challenger and a challengeable position")
        if not 0 <= self.points_per_loss <= self.points_per_win <= 10:
            raise RuleError("Points per loss must be between 0 and points per win, which is at most 10")

    # ---- derived values -----------------------------------------------------------------
    @property
    def rubber_total(self) -> int:
        return self.singles_matches + self.doubles_matches + self.super_tiebreak_matches

    @property
    def rubber_counts(self) -> dict[str, int]:
        return {"singles": self.singles_matches, "doubles": self.doubles_matches, "super_tiebreak": self.super_tiebreak_matches}

    @property
    def wins_to_clinch(self) -> int:
        return self.rubber_total // 2 + 1

    @property
    def allowed_doubles_sets(self) -> list[set[int]]:
        return [set(pair) for pair in self.doubles_pairs]

    def required_singles_days(self, match_days: int) -> int:
        """Official rule: the share of match days, rounded down (8 days at 40% is 3.2, so 3). The epsilon absorbs float error."""
        return floor(match_days * self.min_singles_participation_pct + 1e-9)

    def as_dict(self) -> dict:
        """camelCase form stored in event/division rules and returned by the API."""
        return {
            "teamSize": self.team_size,
            "singlesMatches": self.singles_matches,
            "doublesMatches": self.doubles_matches,
            "superTiebreakMatches": self.super_tiebreak_matches,
            "superTiebreakPoints": self.super_tiebreak_points,
            "singlesPositions": list(self.singles_positions),
            "doublesPairs": [list(pair) for pair in self.doubles_pairs],
            "teamMinRating": self.team_min_rating,
            "teamMaxRating": self.team_max_rating,
            "playerMaxRating": self.player_max_rating,
            "minSinglesParticipationPct": self.min_singles_participation_pct,
            "playoffSize": self.playoff_size,
            "pointsPerWin": self.points_per_win,
            "pointsPerLoss": self.points_per_loss,
            "requireRubbersInRegularSeason": self.require_rubbers_in_regular_season,
            "tiers": [t.as_dict() for t in self.tiers],
            "challengeEnabled": self.challenge_enabled,
            "challengeChallengerPositions": list(self.challenge_challenger_positions),
            "challengeTargetPositions": list(self.challenge_target_positions),
            "challengeCutoffWeeks": self.challenge_cutoff_weeks,
            "requireConsent": self.require_consent,
            "aceNameMaskingEnabled": self.ace_name_masking,
        }


TRIACE_RULE_KEYS = tuple(TriaceRules().as_dict())


def validate_encounter(
    rubbers: list[dict], score_home: int, score_away: int, playoff: bool,
    home_members: dict[str, int | None], away_members: dict[str, int | None], rules: TriaceRules,
) -> None:
    """Check per-match results against the configured encounter format. Raises RuleError."""
    counts = rules.rubber_counts
    summary = ", ".join(f"{count} {kind.replace('_', ' ')}" for kind, count in counts.items() if count)
    strict = playoff or rules.require_rubbers_in_regular_season
    if not rubbers:
        if strict:
            raise RuleError(f"TRIACE results require the full encounter: {summary}")
        return
    kinds = [item["kind"] for item in rubbers]
    if strict and {kind: kinds.count(kind) for kind in counts} != counts:
        raise RuleError(f"Results require exactly: {summary}")
    if len(rubbers) > rules.rubber_total:
        raise RuleError(f"An encounter has at most {rules.rubber_total} matches")
    home_wins = away_wins = 0
    for item in rubbers:
        if item["home_score"] == item["away_score"]:
            raise RuleError("Individual TRIACE rubbers cannot end in a tie")
        home_ids, away_ids = set(item["home_player_ids"]), set(item["away_player_ids"])
        expected = 2 if item["kind"] == "doubles" else 1
        if len(home_ids) != expected or len(away_ids) != expected:
            raise RuleError(f"{item['kind']} requires {expected} player(s) per side")
        if not home_ids.issubset(home_members) or not away_ids.issubset(away_members):
            raise RuleError("Rubber players must be active members of their assigned team")
        if item["kind"] == "singles" and (home_members[next(iter(home_ids))] not in rules.singles_positions or away_members[next(iter(away_ids))] not in rules.singles_positions):
            allowed = ", ".join(f"P{position}" for position in rules.singles_positions)
            raise RuleError(f"TRIACE singles must be played by lineup position {allowed}")
        if item["kind"] == "doubles":
            allowed_pairs = rules.allowed_doubles_sets
            if {home_members[user_id] for user_id in home_ids} not in allowed_pairs or {away_members[user_id] for user_id in away_ids} not in allowed_pairs:
                allowed = " or ".join("+".join(f"P{position}" for position in pair) for pair in rules.doubles_pairs)
                raise RuleError(f"TRIACE doubles must pair {allowed}")
        if item["kind"] == "super_tiebreak" and max(item["home_score"], item["away_score"]) < rules.super_tiebreak_points:
            raise RuleError(f"The super tiebreak winner must reach {rules.super_tiebreak_points} points")
        if item["home_score"] > item["away_score"]:
            home_wins += 1
        else:
            away_wins += 1
    if home_wins != score_home or away_wins != score_away:
        raise RuleError("Fixture totals must equal the submitted rubber wins")
