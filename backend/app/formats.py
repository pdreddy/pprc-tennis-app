"""Tournament format registry and pure draw/ranking logic (no database access)."""
from dataclasses import dataclass

TRIACE_FORMATS = {"triace", "triace_team_round_robin"}


@dataclass(frozen=True)
class FormatInfo:
    key: str
    label: str
    description: str
    individual: bool
    default_rules: dict


# Individual formats share one entry/match engine; TRIACE keeps its team workflow.
INDIVIDUAL_FORMATS: dict[str, FormatInfo] = {
    "round_robin": FormatInfo(
        "round_robin", "Round robin", "Everyone plays everyone once; the table decides the winner.",
        True, {"pointsPerWin": 2},
    ),
    "single_elimination": FormatInfo(
        "single_elimination", "Single elimination", "Seeded knockout bracket with byes; lose once and you are out.",
        True, {},
    ),
    "ladder": FormatInfo(
        "ladder", "Ladder", "Ongoing ranking: challenge players above you and take their rank by winning.",
        True, {"challengeRange": 3},
    ),
}

FORMAT_CATALOG = [
    {"key": "triace_team_round_robin", "label": "TRIACE 2.0", "individual": False,
     "description": "Three-player teams, round robin, then playoffs."},
    *[{"key": f.key, "label": f.label, "individual": f.individual, "description": f.description}
      for f in INDIVIDUAL_FORMATS.values()],
]


def round_robin_rounds(players: list[str]) -> list[list[tuple[str, str]]]:
    """Circle method. Returns rounds of (a, b) pairings; a player with a bye simply sits out."""
    slots: list[str | None] = list(players)
    if len(slots) % 2:
        slots.append(None)
    count = len(slots)
    rounds: list[list[tuple[str, str]]] = []
    for _ in range(count - 1):
        pairs = [(slots[i], slots[count - 1 - i]) for i in range(count // 2)]
        rounds.append([(a, b) for a, b in pairs if a is not None and b is not None])
        slots = [slots[0], slots[-1], *slots[1:-1]]
    return rounds


def seed_positions(size: int) -> list[int]:
    """Standard bracket order for a power-of-two size, e.g. 8 -> 1,8,4,5,2,7,3,6."""
    order = [1]
    while len(order) < size:
        total = len(order) * 2 + 1
        order = [value for seed in order for value in (seed, total - seed)]
    return order


def elimination_rounds(seeded: list[str]) -> list[list[tuple[str | None, str | None]]]:
    """Round 1 first. Match i of a round feeds match i // 2 of the next, slot i % 2.

    `seeded` is best seed first. Missing seeds become byes (None) that sit opposite top seeds.
    """
    if len(seeded) < 2:
        raise ValueError("An elimination bracket needs at least two players")
    size = 1
    while size < len(seeded):
        size *= 2
    by_seed = {index + 1: player for index, player in enumerate(seeded)}
    order = seed_positions(size)
    first = [(by_seed.get(order[i]), by_seed.get(order[i + 1])) for i in range(0, size, 2)]
    rounds: list[list[tuple[str | None, str | None]]] = [first]
    while len(rounds[-1]) > 1:
        rounds.append([(None, None)] * (len(rounds[-1]) // 2))
    return rounds


def elimination_round_name(round_number: int, total_rounds: int) -> str:
    remaining = total_rounds - round_number
    return {0: "final", 1: "semifinal", 2: "quarterfinal"}.get(remaining, f"round_{round_number}")


def ladder_after_win(order: list[str], challenger: str, defender: str) -> list[str]:
    """Challenger takes the defender's rank when ranked below; everyone in between drops one place."""
    low, high = order.index(challenger), order.index(defender)
    if low <= high:
        return list(order)
    updated = list(order)
    updated.pop(low)
    updated.insert(high, challenger)
    return updated


def round_robin_table(players: list[str], results: list[tuple[str, str, str]], points_per_win: int = 2) -> list[dict]:
    """`results` are (player_one, player_two, winner). Sorted by points, wins, head-to-head, then name."""
    table = {p: {"subject_id": p, "played": 0, "wins": 0, "losses": 0, "points": 0} for p in players}
    beaten: dict[str, set[str]] = {p: set() for p in players}
    for one, two, winner in results:
        loser = two if winner == one else one
        for player in (one, two):
            table.setdefault(player, {"subject_id": player, "played": 0, "wins": 0, "losses": 0, "points": 0})
            table[player]["played"] += 1
        beaten.setdefault(winner, set()).add(loser)
        table[winner]["wins"] += 1
        table[winner]["points"] += points_per_win
        table[loser]["losses"] += 1
    rows = list(table.values())
    rows.sort(key=lambda r: (-r["points"], -r["wins"], r["subject_id"]))
    # Two-way ties on points and wins are settled by who won the direct meeting.
    for index in range(len(rows) - 1):
        a, b = rows[index], rows[index + 1]
        if a["points"] == b["points"] and a["wins"] == b["wins"] and a["subject_id"] in beaten.get(b["subject_id"], set()):
            rows[index], rows[index + 1] = b, a
    return rows
