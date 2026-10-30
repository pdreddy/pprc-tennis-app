"""Every TRIACE property as validated, organizer-configurable rules (pure; no database access)."""
from dataclasses import dataclass
from math import ceil


class RuleError(ValueError):
    """A TRIACE rule value is invalid."""


@dataclass(frozen=True)
class TriaceRules:
    team_size: int = 3
    singles_matches: int = 2
    doubles_matches: int = 2
    super_tiebreak_matches: int = 1
    super_tiebreak_points: int = 10
    singles_positions: tuple[int, ...] = (1, 2)
    doubles_pairs: tuple[tuple[int, int], ...] = ((1, 3), (2, 3))
    team_min_rating: float = 12.0
    team_max_rating: float = 18.5
    player_max_rating: float = 20.0
    min_singles_participation_pct: float = 0.4
    playoff_size: int = 4
    points_per_win: int = 3
    points_per_loss: int = 0
    require_rubbers_in_regular_season: bool = False

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
            )
        except (TypeError, ValueError) as exc:
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
        if self.playoff_size not in {2, 4}:
            raise RuleError("TRIACE playoffs support two or four teams")
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
        return ceil(match_days * self.min_singles_participation_pct)

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
