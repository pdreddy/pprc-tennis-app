"""PPRC Rating: an original, deterministic tennis rating (pure; no database access).

Formula version pprc-rating-1.0 — see docs/PPRC_RATING.md. Ratings run 1.00–16.50 and are
tracked separately for singles and doubles. Only verified (finalized) results with a real score
are rated; walkovers, incomplete and no-score matches never move a rating.
"""
import re
from dataclasses import dataclass, field
from datetime import datetime

FORMULA_VERSION = "pprc-rating-1.0"
MIN_RATING, MAX_RATING = 1.0, 16.5
DEFAULT_START = 5.0
SCALE = 3.0  # rating gap at which the favourite is expected to win 90.9% of performance
BASE_K = 0.30  # maximum move for an established player in a best-of-3 at full surprise
PROVISIONAL_MATCHES = 5
RELIABLE_WEIGHT = 12.0  # weighted verified matches needed for 100% reliability
WIN_SHARE = 0.6  # performance = 60% result + 40% share of games won
MIN_RETIRED_GAMES = 6
FORMAT_WEIGHTS = {"best_of_5": 1.1, "best_of_3": 1.0, "pro_set": 0.8, "one_set": 0.7, "tiebreak": 0.4}
RATEABLE_OUTCOMES = {"completed", "retired"}
OUTCOMES = {"completed", "retired", "walkover", "incomplete", "no_score"}
KINDS = {"singles", "doubles"}


def clamp(value: float) -> float:
    return round(min(MAX_RATING, max(MIN_RATING, value)), 4)


def parse_score(text: str | None) -> tuple[int, int, int, int] | None:
    """'6-3 4-6 10-7' -> (games_one, games_two, sets_one, sets_two). A set above 7 is a match tiebreak worth one game."""
    if not text:
        return None
    sets = re.findall(r"(\d{1,2})\s*[-–]\s*(\d{1,2})", text)
    if not sets:
        return None
    games_one = games_two = sets_one = sets_two = 0
    for a, b in ((int(x), int(y)) for x, y in sets):
        if a == b:
            continue
        if max(a, b) > 7:  # match tiebreak, e.g. 10-7
            a, b = (1, 0) if a > b else (0, 1)
        games_one, games_two = games_one + a, games_two + b
        sets_one, sets_two = sets_one + (a > b), sets_two + (b > a)
    return games_one, games_two, sets_one, sets_two


def expected(rating_a: float, rating_b: float) -> float:
    return 1 / (1 + 10 ** ((rating_b - rating_a) / SCALE))


def recency_weight(played_at: datetime, as_of: datetime) -> float:
    days = (as_of - played_at).days
    return 1.0 if days <= 180 else 0.75 if days <= 365 else 0.5


def is_rateable(outcome: str, games_one: int | None, games_two: int | None) -> bool:
    if outcome not in RATEABLE_OUTCOMES or games_one is None or games_two is None:
        return False
    total = games_one + games_two
    return total > 0 and (outcome != "retired" or total >= MIN_RETIRED_GAMES)


@dataclass
class PlayerState:
    rating: float
    weight: float = 0.0
    verified: int = 0
    wins: int = 0
    losses: int = 0
    last_played_at: datetime | None = None

    @property
    def reliability(self) -> float:
        return round(min(1.0, self.weight / RELIABLE_WEIGHT) * 100, 1)

    @property
    def provisional(self) -> bool:
        return self.verified < PROVISIONAL_MATCHES


@dataclass(frozen=True)
class RatedInput:
    id: str
    kind: str
    side_one: tuple[str, ...]
    side_two: tuple[str, ...]
    winner_side: int  # 1 or 2
    games_one: int
    games_two: int
    match_format: str
    played_at: datetime


@dataclass
class Change:
    match_id: str
    user_id: str
    kind: str
    before: float
    after: float
    played_at: datetime


@dataclass
class ReplayResult:
    states: dict[tuple[str, str], PlayerState] = field(default_factory=dict)
    changes: list[Change] = field(default_factory=list)


def replay(start: dict[tuple[str, str], float], matches: list[RatedInput], as_of: datetime | None = None) -> ReplayResult:
    """Recompute every rating from the starting ratings and all rateable matches, oldest first.

    Deterministic: the same inputs always give the same ratings, so corrections and reversals
    are handled by simply replaying. `start` maps (user_id, kind) to a provisional starting rating.
    """
    ordered = sorted(matches, key=lambda m: (m.played_at, m.id))
    as_of = as_of or (ordered[-1].played_at if ordered else None)
    result = ReplayResult()

    def state(user: str, kind: str) -> PlayerState:
        key = (user, kind)
        if key not in result.states:
            result.states[key] = PlayerState(rating=clamp(start.get(key, DEFAULT_START)))
        return result.states[key]

    for match in ordered:
        ones = [state(u, match.kind) for u in match.side_one]
        twos = [state(u, match.kind) for u in match.side_two]
        side_one = sum(s.rating for s in ones) / len(ones)
        side_two = sum(s.rating for s in twos) / len(twos)
        exp_one = expected(side_one, side_two)
        win_one = 1.0 if match.winner_side == 1 else 0.0
        share_one = match.games_one / (match.games_one + match.games_two)
        perf_one = WIN_SHARE * win_one + (1 - WIN_SHARE) * share_one
        weight = FORMAT_WEIGHTS.get(match.match_format, 1.0) * recency_weight(match.played_at, as_of)
        for users, states, perf, exp, won in ((match.side_one, ones, perf_one, exp_one, win_one == 1), (match.side_two, twos, 1 - perf_one, 1 - exp_one, win_one == 0)):
            for user, player in zip(users, states, strict=True):
                k = BASE_K * weight * (1 + 1.5 * (1 - player.reliability / 100))
                before = player.rating
                delta = k * (perf - exp)
                # A win never lowers a rating and a loss never raises one.
                delta = max(delta, 0.0) if won else min(delta, 0.0)
                player.rating = clamp(before + delta)
                player.weight += weight
                player.verified += 1
                player.wins, player.losses = player.wins + won, player.losses + (not won)
                player.last_played_at = match.played_at
                result.changes.append(Change(match.id, user, match.kind, before, player.rating, match.played_at))
    return result
