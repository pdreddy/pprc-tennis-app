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
    "double_elimination": FormatInfo(
        "double_elimination", "Double elimination",
        "Winners and losers brackets: a player is out after two losses. Grand final with a reset.",
        True, {},
    ),
    "swiss": FormatInfo(
        "swiss", "Swiss", "A fixed number of rounds; each round pairs players with similar records.",
        True, {"pointsPerWin": 2, "swissRounds": 0},
    ),
    "ladder": FormatInfo(
        "ladder", "Ladder", "Ongoing ranking: challenge players above you and take their rank by winning.",
        True, {"challengeRange": 3, "challengeExpiryDays": 14, "challengeExpiryAction": "cancel"},
    ),
}
ENTRY_TYPES = {"singles", "doubles"}
DEAD = "~bye"  # slot that will never receive a player

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


def round_robin_table(players: list[str], results: list[tuple[str, str | None, str]], points_per_win: int = 2) -> list[dict]:
    """`results` are (player_one, player_two, winner). Sorted by points, wins, head-to-head, then name."""
    table = {p: {"subject_id": p, "played": 0, "wins": 0, "losses": 0, "points": 0} for p in players}
    beaten: dict[str, set[str]] = {p: set() for p in players}
    for one, two, winner in results:
        if two is None:  # a bye counts as a played win
            table.setdefault(winner, {"subject_id": winner, "played": 0, "wins": 0, "losses": 0, "points": 0})
            table[winner]["played"] += 1
            table[winner]["wins"] += 1
            table[winner]["points"] += points_per_win
            continue
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


def double_elimination_graph(size: int) -> list[dict]:
    """Node list for a double-elimination bracket of `size` (a power of two, >= 2).

    Each node has bracket (W, L, GF, GR), round, position, and (index, slot) routes for the
    winner and loser. GF is the grand final; GR is the reset played only if the losers-bracket
    finalist wins the grand final.
    """
    if size < 2 or size & (size - 1):
        raise ValueError("size must be a power of two >= 2")
    k = size.bit_length() - 1
    nodes: list[dict] = []
    index: dict[tuple[str, int, int], int] = {}

    def add(bracket: str, round_number: int, position: int) -> None:
        index[(bracket, round_number, position)] = len(nodes)
        nodes.append({"bracket": bracket, "round": round_number, "position": position, "winner_to": None, "loser_to": None})

    for r in range(1, k + 1):
        for p in range(size >> r):
            add("W", r, p)
    for j in range(1, k):
        for round_number in (2 * j - 1, 2 * j):
            for p in range(size >> (j + 1)):
                add("L", round_number, p)
    add("GF", 1, 0)
    add("GR", 1, 0)
    grand = index[("GF", 1, 0)]
    for r in range(1, k + 1):
        for p in range(size >> r):
            node = nodes[index[("W", r, p)]]
            node["winner_to"] = (index[("W", r + 1, p // 2)], p % 2) if r < k else (grand, 0)
            if r == 1:
                node["loser_to"] = (grand, 1) if k == 1 else (index[("L", 1, p // 2)], p % 2)
            else:
                node["loser_to"] = (index[("L", 2 * (r - 1), p)], 1)
    for j in range(1, k):
        for p in range(size >> (j + 1)):
            nodes[index[("L", 2 * j - 1, p)]]["winner_to"] = (index[("L", 2 * j, p)], 0)
            even = nodes[index[("L", 2 * j, p)]]
            even["winner_to"] = (index[("L", 2 * j + 1, p // 2)], p % 2) if j < k - 1 else (grand, 1)
    return nodes


def settle_step(one: str | None, two: str | None) -> tuple[str, str | None]:
    """Decide what a bracket match with these two slots should become."""
    if one is None or two is None:
        return "wait", None
    if one == DEAD and two == DEAD:
        return "dead", DEAD
    if one == DEAD:
        return "bye", two
    if two == DEAD:
        return "bye", one
    return "scheduled", None


def swiss_round_count(players: int) -> int:
    rounds = 1
    while 2**rounds < players:
        rounds += 1
    return rounds


def swiss_pairings(order: list[str], wins: dict[str, int], played: set[frozenset], had_bye: set[str]) -> tuple[list[tuple[str, str]], str | None]:
    """Pair players by record (ties broken by `order`), avoiding rematches; odd fields give one bye."""
    ranked = sorted(order, key=lambda p: (-wins.get(p, 0), order.index(p)))
    bye = None
    if len(ranked) % 2:
        candidates = [p for p in reversed(ranked) if p not in had_bye] or [ranked[-1]]
        bye = candidates[0]
        ranked.remove(bye)
    budget = [20000]

    def solve(remaining: list[str], banned: set[frozenset]) -> list[tuple[str, str]] | None:
        if not remaining:
            return []
        budget[0] -= 1
        if budget[0] < 0:
            return None
        first = remaining[0]
        for i in range(1, len(remaining)):
            other = remaining[i]
            if frozenset((first, other)) in banned:
                continue
            rest = solve(remaining[1:i] + remaining[i + 1:], banned)
            if rest is not None:
                return [(first, other), *rest]
        return None

    pairs = solve(ranked, played)
    if pairs is None:  # no rematch-free pairing exists; allow repeats rather than stall the event
        pairs = solve(ranked, set()) or [(ranked[i], ranked[i + 1]) for i in range(0, len(ranked), 2)]
    return pairs, bye
