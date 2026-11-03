"""Pure-structure refactor: replace whole top-level blocks by name. Behaviour is unchanged."""
import os
import re

os.chdir("/app/backend")


def block(s: str, start: str) -> tuple[int, int]:
    i = s.index(start)
    j = s.find("\n\n\n", i)
    return i, (len(s) if j == -1 else j)


def replace_block(s: str, start: str, new: str) -> str:
    i, j = block(s, start)
    return s[:i] + new.strip("\n") + s[j:]


C = "app/competitions.py"
s = open(C).read()

s = replace_block(s, "async def ensure_entry(", '''
@dataclass
class EntrySpec:
    """Who is entering a division (and with whom, for doubles)."""
    user_id: str
    display_name: str
    rating: float | None = None
    seed: int | None = None
    partner_user_id: str | None = None
    partner_name: str | None = None


def check_partner(division: Division, spec: EntrySpec) -> None:
    if is_doubles(division):
        if not spec.partner_user_id or spec.partner_user_id == spec.user_id:
            raise HTTPException(status_code=422, detail="Doubles entries need a different partner")
    elif spec.partner_user_id:
        raise HTTPException(status_code=422, detail="This division is for singles")


async def check_entry_room(session: AsyncSession, division: Division, spec: EntrySpec, entry: DivisionEntry | None) -> None:
    """Not already entered, nobody double-booked, and the division has space."""
    if entry is not None and entry.status == "active":
        raise HTTPException(status_code=409, detail="Already entered in this division")
    people = {spec.user_id, *({spec.partner_user_id} if spec.partner_user_id else set())}
    clash = await session.scalar(select(DivisionEntry.id).where(
        DivisionEntry.division_id == division.id, DivisionEntry.status == "active",
        (DivisionEntry.user_id.in_(people)) | (DivisionEntry.partner_user_id.in_(people)),
    ).limit(1))
    if clash:
        raise HTTPException(status_code=409, detail="A player is already entered in this division")
    count = int(await session.scalar(select(func.count()).select_from(DivisionEntry).where(DivisionEntry.division_id == division.id, DivisionEntry.status == "active")) or 0)
    if count >= division.capacity:
        raise HTTPException(status_code=409, detail="Division is full")


async def next_ladder_rank(session: AsyncSession, division: Division) -> int:
    return int(await session.scalar(select(func.coalesce(func.max(DivisionEntry.rank), 0)).where(DivisionEntry.division_id == division.id, DivisionEntry.status == "active")) or 0) + 1


async def ensure_entry(session: AsyncSession, division: Division, spec: EntrySpec) -> DivisionEntry:
    """Create or reactivate an entry. Caller has already checked permissions and event state."""
    check_partner(division, spec)
    entry = await session.scalar(select(DivisionEntry).where(DivisionEntry.division_id == division.id, DivisionEntry.user_id == spec.user_id))
    await check_entry_room(session, division, spec, entry)
    if entry is None:
        entry = DivisionEntry(club_id=division.club_id, division_id=division.id, user_id=spec.user_id, display_name=spec.display_name)
        session.add(entry)
    entry.status, entry.display_name = "active", spec.display_name
    entry.partner_user_id, entry.partner_name = spec.partner_user_id, spec.partner_name or spec.partner_user_id
    if spec.rating is not None:
        entry.rating = spec.rating
    if spec.seed is not None:
        entry.seed = spec.seed
    if division.format == "ladder":
        entry.rank = await next_ladder_rank(session, division)
    await session.flush()
    return entry
''')
s = s.replace("await ensure_entry(session, division, user_id, display_name)", "await ensure_entry(session, division, EntrySpec(user_id, display_name))")

s = replace_block(s, '@router.post("/v1/divisions/{division_id}/entries"', '''
def registration_closed(event: Event) -> bool:
    closes_at = event.rules.get("registrationClose")
    if not closes_at:
        return False
    try:
        close_time = datetime.fromisoformat(str(closes_at).replace("Z", "+00:00"))
    except ValueError:
        return False
    if close_time.tzinfo is None:
        close_time = close_time.replace(tzinfo=timezone.utc)
    return close_time <= datetime.now(timezone.utc)


def check_entry_permissions(event: Event, payload: EntryCreate, actor: Actor, target: str, staff: Membership | None) -> None:
    if event.status == EventStatus.completed or event.status == EventStatus.draft and staff is None:
        raise HTTPException(status_code=409, detail="Event is not open for entries")
    if target != actor.user_id and staff is None:
        raise HTTPException(status_code=403, detail="Only organizers can enter other players")
    if staff is not None:
        return
    if event.status != EventStatus.published:
        raise HTTPException(status_code=409, detail="Event is not open for entries")
    if registration_closed(event):
        raise HTTPException(status_code=409, detail="Registration has closed")
    if payload.rating is not None or payload.seed is not None:
        raise HTTPException(status_code=403, detail="Only organizers can set ratings and seeds")


async def late_round_robin_entry(session: AsyncSession, division: Division, staff: Membership | None) -> bool:
    """True when an organizer adds a player to a running round robin; any other started draw is closed."""
    started = division.format != "ladder" and bool(await session.scalar(select(CompetitionMatch.id).where(CompetitionMatch.division_id == division.id).limit(1)))
    late = started and division.format == "round_robin" and staff is not None
    if started and not late:
        raise HTTPException(status_code=409, detail="The draw has already been generated")
    return late


async def entry_names(session: AsyncSession, division: Division, payload: EntryCreate, actor: Actor, target: str) -> dict[str, str]:
    """Club display names for the entrant and partner, adding club memberships when missing."""
    names: dict[str, str] = {}
    for person in [target, *([payload.partner_user_id] if payload.partner_user_id else [])]:
        membership = await session.scalar(select(Membership).where(Membership.club_id == division.club_id, Membership.user_id == person))
        if membership is None:
            label = (payload.display_name if person == target else payload.partner_name) or (actor.name if person == actor.user_id else None) or person
            membership = Membership(club_id=division.club_id, user_id=person, display_name=label)
            session.add(membership)
        names[person] = membership.display_name
    return names


@router.post("/v1/divisions/{division_id}/entries", response_model=EntryRead, status_code=status.HTTP_201_CREATED)
async def add_entry(division_id: UUID, payload: EntryCreate, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> DivisionEntry:
    """Players enter themselves (with a partner for doubles) while registration is open; organizers can enter anyone."""
    division, event = await load_division(session, division_id)
    staff = await staff_membership(session, division.club_id, actor.user_id)
    target = payload.user_id or actor.user_id
    check_entry_permissions(event, payload, actor, target, staff)
    late = await late_round_robin_entry(session, division, staff)
    names = await entry_names(session, division, payload, actor, target)
    partner_name = payload.partner_name or (names.get(payload.partner_user_id) if payload.partner_user_id else None)
    entry = await ensure_entry(session, division, EntrySpec(target, payload.display_name or names[target], payload.rating, payload.seed, payload.partner_user_id, partner_name))
    if late:
        await add_late_round_robin_matches(session, division, entry)
    await audit(session, division.club_id, actor.user_id, "entry.created_late" if late else "entry.created", "entry", str(entry.id))
    await session.commit()
    return entry
''')

s = replace_block(s, '@router.post("/v1/divisions/{division_id}/draw"', '''
def round_robin_matches(division: Division, players: list[str], round_name, when) -> list[CompetitionMatch]:
    return [
        new_match(division, round_number=r, round_name=round_name(r), position=p, player_one_id=one, player_two_id=two, status="scheduled", starts_at=when(r - 1))
        for r, pairs in enumerate(round_robin_rounds(players), start=1) for p, (one, two) in enumerate(pairs)
    ]


async def draw_ladder(session: AsyncSession, division: Division, entries: list[DivisionEntry], when) -> list[CompetitionMatch]:
    for index, entry in enumerate(entries, start=1):
        entry.rank = index
    return []


async def draw_round_robin(session: AsyncSession, division: Division, entries: list[DivisionEntry], when) -> list[CompetitionMatch]:
    matches = round_robin_matches(division, [e.user_id for e in entries], lambda r: f"round_{r}", when)
    session.add_all(matches)
    return matches


async def draw_swiss(session: AsyncSession, division: Division, entries: list[DivisionEntry], when) -> list[CompetitionMatch]:
    players = [e.user_id for e in entries]
    total = int(division.rules.get("swissRounds") or 0) or swiss_round_count(len(players))
    division.rules = {**division.rules, "swissRounds": total}
    matches = swiss_round(division, 1, players, {}, set(), set(), when(0))
    session.add_all(matches)
    return matches


async def draw_single_elimination(session: AsyncSession, division: Division, entries: list[DivisionEntry], when) -> list[CompetitionMatch]:
    return await build_elimination(session, division, [e.user_id for e in entries], 0, when)


async def draw_groups(session: AsyncSession, division: Division, entries: list[DivisionEntry], when) -> list[CompetitionMatch]:
    """Snake-seeded groups, each playing its own round robin."""
    players = [e.user_id for e in entries]
    by_user = {e.user_id: e for e in entries}
    count = group_count_for(len(players), int(division.rules.get("groupSize", 4)), int(division.rules.get("groupCount", 0)))
    matches: list[CompetitionMatch] = []
    for index, members in enumerate(snake_groups(players, count)):
        label = group_label(index)
        for member in members:
            by_user[member].group_label = label
        matches += round_robin_matches(division, members, lambda r, label=label: f"group_{label}", when)
    session.add_all(matches)
    return matches


def double_elimination_matches(division: Division, size: int, when) -> list[CompetitionMatch]:
    """Every node of the double-elimination graph, linked by winner and loser routes."""
    graph = double_elimination_graph(size)
    names = {"GF": "grand_final", "GR": "grand_final_reset"}
    built = []
    for node in graph:
        bracket, number = node["bracket"], node["round"]
        offset = 0 if bracket in {"W", "L"} else size.bit_length() + (0 if bracket == "GF" else 1)
        name = names.get(bracket) or f"{'winners' if bracket == 'W' else 'losers'}_round_{number}"
        built.append(new_match(division, round_number=number + offset, round_name=name, position=node["position"], status="pending", starts_at=when(number - 1)))
    for node, match in zip(graph, built):
        if node["winner_to"]:
            match.next_match_id, match.next_slot = built[node["winner_to"][0]].id, node["winner_to"][1]
        if node["loser_to"]:
            match.loser_match_id, match.loser_slot = built[node["loser_to"][0]].id, node["loser_to"][1]
    return built


async def draw_double_elimination(session: AsyncSession, division: Division, entries: list[DivisionEntry], when) -> list[CompetitionMatch]:
    first = elimination_rounds([e.user_id for e in entries])[0]
    built = double_elimination_matches(division, len(first) * 2, when)
    for position, (one, two) in enumerate(first):
        built[position].player_one_id, built[position].player_two_id = one or DEAD, two or DEAD
    # Insert targets before the matches that point at them (reverse of creation order).
    session.add_all(list(reversed(built)))
    await session.flush()
    for match in built[: len(first)]:
        await settle(session, division, match)
    return built


DRAW_BUILDERS = {
    "ladder": draw_ladder, "round_robin": draw_round_robin, "swiss": draw_swiss,
    "single_elimination": draw_single_elimination, "groups_knockout": draw_groups, "double_elimination": draw_double_elimination,
}


async def check_draw_ready(session: AsyncSession, division: Division, event: Event) -> list[DivisionEntry]:
    if event.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="Open registration before generating the draw")
    if await session.scalar(select(CompetitionMatch.id).where(CompetitionMatch.division_id == division.id).limit(1)):
        raise HTTPException(status_code=409, detail="A draw or challenges already exist for this division")
    entries = await active_entries(session, division.id)
    if len(entries) < 2:
        raise HTTPException(status_code=422, detail="At least two players are needed")
    return entries


@router.post("/v1/divisions/{division_id}/draw", response_model=list[CompetitionMatchRead], status_code=status.HTTP_201_CREATED)
async def generate_draw(division_id: UUID, payload: DrawGenerate, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[CompetitionMatch]:
    """Round robin schedule, elimination brackets, the first Swiss round, or the initial ladder ranking."""
    division, event = await load_division(session, division_id)
    await require_role(session, division.club_id, actor.user_id, STAFF_ROLES)
    entries = await check_draw_ready(session, division, event)

    def when(offset: int) -> datetime | None:
        return payload.starts_at + timedelta(days=7 * offset) if payload.starts_at else None

    matches = await DRAW_BUILDERS.get(division.format, draw_double_elimination)(session, division, entries, when)
    await audit(session, division.club_id, actor.user_id, "draw.generated", "division", str(division.id), division.format)
    await session.commit()
    return [match for match in matches if match.status != "dead"]
''')

s = replace_block(s, "async def build_elimination(", '''
def elimination_grid(division: Division, players: list[str], round_offset: int, when) -> list[list[CompetitionMatch]]:
    """All rounds of a seeded bracket, each match linked to the one its winner moves to."""
    rounds = elimination_rounds(players)
    grid = [[new_match(
        division, round_number=number + round_offset, round_name=elimination_round_name(number, len(rounds)), position=position,
        player_one_id=one, player_two_id=two, status="pending", starts_at=when(number - 1 + round_offset),
    ) for position, (one, two) in enumerate(pairs)] for number, pairs in enumerate(rounds, start=1)]
    for round_index, row in enumerate(grid[:-1]):
        for position, match in enumerate(row):
            match.next_match_id, match.next_slot = grid[round_index + 1][position // 2].id, position % 2
    return grid


def add_third_place(division: Division, grid: list[list[CompetitionMatch]]) -> CompetitionMatch | None:
    if not division.rules.get("thirdPlaceMatch") or len(grid) < 2:
        return None
    final = grid[-1][0]
    third_place = new_match(division, round_number=final.round_number, round_name="third_place", position=1, status="pending", starts_at=final.starts_at)
    for position, semifinal in enumerate(grid[-2]):
        semifinal.loser_match_id, semifinal.loser_slot = third_place.id, position
    grid.append([third_place])
    return third_place


def settle_first_round(grid: list[list[CompetitionMatch]], third_place: CompetitionMatch | None) -> None:
    """Schedule full first-round matches; a bye sends the lone player straight to the next round."""
    for match in grid[0]:
        if match.player_one_id and match.player_two_id:
            match.status = "scheduled"
            continue
        winner = match.player_one_id or match.player_two_id
        match.status, match.winner_id = "bye", winner
        nxt = next(m for m in grid[1] if m.id == match.next_match_id)
        place(nxt, match.next_slot or 0, winner)
        if nxt.player_one_id and nxt.player_two_id:
            nxt.status = "scheduled"
        if third_place is not None and match.loser_match_id == third_place.id:
            third_place.status = "dead"  # a semifinal bye leaves no loser to play for third


async def build_elimination(session: AsyncSession, division: Division, players: list[str], round_offset: int, when) -> list[CompetitionMatch]:
    """Seeded single-elimination bracket (best seed first) with byes settled; returns all matches."""
    grid = elimination_grid(division, players, round_offset, when)
    third_place = add_third_place(division, grid)
    # Later rounds are inserted first so next_match_id always points at an existing row.
    session.add_all([match for row in reversed(grid) for match in row])
    await session.flush()
    settle_first_round(grid, third_place)
    return [match for row in grid for match in row]
''')

s = replace_block(s, '@router.post("/v1/divisions/{division_id}/groups/advance"', '''
def finished_group_matches(matches: list[CompetitionMatch]) -> list[CompetitionMatch]:
    group_matches = [m for m in matches if m.round_name.startswith("group_")]
    if not group_matches:
        raise HTTPException(status_code=409, detail="Generate the group draw first")
    if len(group_matches) != len(matches):
        raise HTTPException(status_code=409, detail="The knockout bracket already exists")
    if any(m.status != "finalized" for m in group_matches):
        raise HTTPException(status_code=409, detail="Finish every group match first")
    return group_matches


def group_results(matches: list[CompetitionMatch], label: str) -> list[tuple[str | None, str | None, str]]:
    return [(m.player_one_id, m.player_two_id, m.winner_id) for m in matches if m.round_name == f"group_{label}" and m.status == "finalized" and m.winner_id]


def group_qualifiers(division: Division, entries: list[DivisionEntry], group_matches: list[CompetitionMatch]) -> list[list[str]]:
    advance, ppw = int(division.rules.get("advancePerGroup", 2)), int(division.rules.get("pointsPerWin", 2))
    qualifiers = []
    for label in sorted({e.group_label for e in entries}):
        members = [e.user_id for e in entries if e.group_label == label]
        qualifiers.append([row["subject_id"] for row in round_robin_table(members, group_results(group_matches, label), ppw)][:advance])
    return qualifiers


@router.post("/v1/divisions/{division_id}/groups/advance", response_model=list[CompetitionMatchRead], status_code=status.HTTP_201_CREATED)
async def advance_groups(division_id: UUID, payload: DrawGenerate, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[CompetitionMatch]:
    """Take the top finishers from every group into a seeded knockout bracket."""
    division, event = await load_division(session, division_id)
    if division.format != "groups_knockout":
        raise HTTPException(status_code=422, detail="Only groups + knockout divisions have a group stage")
    await require_role(session, division.club_id, actor.user_id, STAFF_ROLES)
    if event.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="The event is not running")
    group_matches = finished_group_matches(await division_matches(session, division.id))
    qualifiers = group_qualifiers(division, [e for e in await active_entries(session, division.id) if e.group_label], group_matches)
    seeds = separate_groups(knockout_seeds(qualifiers), {p: i for i, group in enumerate(qualifiers) for p in group})
    if len(seeds) < 2:
        raise HTTPException(status_code=422, detail="At least two qualifiers are needed for the knockout")
    offset = max(m.round_number for m in group_matches)
    created = await build_elimination(session, division, seeds, offset, lambda n: payload.starts_at + timedelta(days=7 * (n - offset)) if payload.starts_at else None)
    await audit(session, division.club_id, actor.user_id, "groups.advanced", "division", str(division.id), str(len(seeds)))
    await session.commit()
    return created
''')

s = replace_block(s, '@router.get("/v1/divisions/{division_id}/player-standings"', '''
def group_standings(entries: list[DivisionEntry], matches: list[CompetitionMatch], names: dict[str, str], ppw: int) -> list[PlayerStandingRead]:
    rows: list[PlayerStandingRead] = []
    for label in sorted({e.group_label for e in entries if e.group_label}):
        members = [e.user_id for e in entries if e.group_label == label]
        rows += [PlayerStandingRead(display_name=names.get(r["subject_id"], r["subject_id"]), group=label, **r) for r in round_robin_table(members, group_results(matches, label), ppw)]
    return rows


def apply_swiss_tiebreak(table: list[dict], results: list[tuple]) -> None:
    """Buchholz tiebreak, then re-sort by points, wins and tiebreak."""
    tiebreak = buchholz(results, {row["subject_id"]: row["points"] for row in table})
    for row in table:
        row["tiebreak"] = tiebreak.get(row["subject_id"], 0.0)
    table.sort(key=lambda r: (-r["points"], -r["wins"], -r["tiebreak"], r["subject_id"]))


def division_results(division: Division, matches: list[CompetitionMatch]) -> list[tuple]:
    results = [(m.player_one_id, m.player_two_id, m.winner_id) for m in matches if m.status == "finalized" and m.winner_id]
    if division.format == "swiss":  # a Swiss bye counts as a played win
        results += [(m.player_one_id, None, m.player_one_id) for m in matches if m.status == "bye"]
    return results


@router.get("/v1/divisions/{division_id}/player-standings", response_model=list[PlayerStandingRead])
async def player_standings(division_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[PlayerStandingRead]:
    division, _ = await load_division(session, division_id)
    await require_role(session, division.club_id, actor.user_id, set(MembershipRole))
    entries = list((await session.scalars(select(DivisionEntry).where(DivisionEntry.division_id == division_id))).all())
    names = {entry.user_id: entry.display_name for entry in entries}
    matches = await division_matches(session, division_id)
    ppw = int(division.rules.get("pointsPerWin", 2))
    if division.format == "groups_knockout":
        return group_standings(entries, matches, names, ppw)
    results = division_results(division, matches)
    table = round_robin_table([entry.user_id for entry in entries], results, ppw)
    if division.format == "swiss":
        apply_swiss_tiebreak(table, results)
    return [PlayerStandingRead(display_name=names.get(row["subject_id"], row["subject_id"]), **row) for row in table]
''')

s = replace_block(s, "async def finalize_match(", '''
async def check_correction_allowed(session: AsyncSession, match: CompetitionMatch, winner: str) -> None:
    """A changed winner cannot be corrected once the match it fed into has been played."""
    if match.winner_id == winner:
        return
    for target_id in (match.next_match_id, match.loser_match_id):
        target = await session.get(CompetitionMatch, target_id) if target_id else None
        if target is not None and target.status in {"reported", "finalized"}:
            raise HTTPException(status_code=409, detail="The next round has already been played; correct that result first")


async def resolve_grand_final(session: AsyncSession, division: Division, match: CompetitionMatch, winner: str) -> None:
    reset = await session.scalar(select(CompetitionMatch).where(CompetitionMatch.division_id == division.id, CompetitionMatch.round_name == "grand_final_reset"))
    if reset is None:
        return
    if winner == match.player_one_id:  # the unbeaten winners-bracket finalist wins outright
        reset.status, reset.winner_id = "dead", winner
    else:  # first loss for the winners-bracket finalist: play the deciding reset
        reset.player_one_id, reset.player_two_id, reset.winner_id, reset.status = match.player_one_id, match.player_two_id, None, "scheduled"


async def advance_bracket(session: AsyncSession, division: Division, match: CompetitionMatch, winner: str, loser: str | None) -> None:
    """Move the winner (and, where routed, the loser) into their next matches."""
    for target_id, slot, person in ((match.next_match_id, match.next_slot, winner), (match.loser_match_id, match.loser_slot, loser)):
        if not target_id:
            continue
        target = await session.get(CompetitionMatch, target_id)
        place(target, slot or 0, person)
        if division.format == "double_elimination":
            await settle(session, division, target)
        elif target.player_one_id and target.player_two_id and target.status == "pending":
            target.status = "scheduled"
            await forfeit_if_withdrawn(session, division, target)


async def move_ladder(session: AsyncSession, division: Division, match: CompetitionMatch) -> None:
    """A successful challenger takes the defender's rank."""
    entries = list((await session.scalars(select(DivisionEntry).where(DivisionEntry.division_id == division.id, DivisionEntry.status == "active"))).all())
    by_user = {entry.user_id: entry for entry in entries}
    if match.player_one_id not in by_user or match.player_two_id not in by_user:
        return
    order = [entry.user_id for entry in sorted(entries, key=lambda e: e.rank or 10**6)]
    for index, user_id in enumerate(ladder_after_win(order, match.player_one_id, match.player_two_id), start=1):
        by_user[user_id].rank = index


async def finalize_match(session: AsyncSession, division: Division, match: CompetitionMatch, winner: str, *, correction: bool) -> None:
    """Record the winner and move players along the bracket, ladder or reset logic."""
    loser = match.player_two_id if winner == match.player_one_id else match.player_one_id
    if correction:
        await check_correction_allowed(session, match, winner)
    match.winner_id, match.status = winner, "finalized"
    await rate_competition_match(session, division, match, winner)
    if match.round_name == "grand_final":
        await resolve_grand_final(session, division, match, winner)
        return
    if division.format in BRACKET_FORMATS:
        await advance_bracket(session, division, match, winner, loser)
    if division.format == "ladder" and match.round_name == "challenge" and winner == match.player_one_id:
        await move_ladder(session, division, match)
''')

s = replace_block(s, '@router.post("/v1/competition-matches/{match_id}/result"', '''
def check_can_submit(match: CompetitionMatch, match_sides: list[set[str]], my_side: int | None, staff: Membership | None, payload: CompetitionResult) -> None:
    if staff is None and my_side is None:
        raise HTTPException(status_code=403, detail="Only participants or organizers can submit this score")
    if match.status in {"pending", "bye", "dead"} or not all(match_sides):
        raise HTTPException(status_code=409, detail="This match is not ready to be played")
    if payload.score_one == payload.score_two:
        raise HTTPException(status_code=422, detail="Matches cannot end in a tie")
    if match.status == "reported" and staff is None and side_of(match_sides, match.reported_by) != my_side:
        raise HTTPException(status_code=409, detail="Awaiting the opponent's confirmation or dispute")


def check_correction(division: Division, staff: Membership | None, payload: CompetitionResult) -> None:
    if staff is None:
        raise HTTPException(status_code=409, detail="Finalized scores need an organizer correction")
    if division.format == "ladder":
        raise HTTPException(status_code=409, detail="Ladder results cannot be corrected because ranks have already moved")
    if not payload.audit_reason:
        raise HTTPException(status_code=422, detail="A correction needs an audit reason")


async def report_for_confirmation(session: AsyncSession, division: Division, match: CompetitionMatch, actor: Actor, opponents: set[str]) -> None:
    match.status, match.reported_by = "reported", actor.user_id
    for other in opponents:
        await notify(session, match.club_id, other, "match", "Score awaiting confirmation", "Your opponent reported a score that needs your confirmation.", {"matchId": str(match.id), "divisionId": str(division.id)})
    await audit(session, match.club_id, actor.user_id, "match.reported", "match", str(match.id))


@router.post("/v1/competition-matches/{match_id}/result", response_model=CompetitionMatchRead)
async def submit_result(match_id: UUID, payload: CompetitionResult, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> CompetitionMatch:
    """Organizers finalize a score; a participant reports it and the opposing side confirms."""
    match = await session.get(CompetitionMatch, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    division, event = await load_division(session, match.division_id)
    if event.status == EventStatus.completed:
        raise HTTPException(status_code=409, detail="Completed events cannot accept score changes")
    staff = await staff_membership(session, match.club_id, actor.user_id)
    match_sides = await sides(session, match)
    my_side = side_of(match_sides, actor.user_id)
    check_can_submit(match, match_sides, my_side, staff, payload)
    correction = match.status == "finalized"
    if correction:
        check_correction(division, staff, payload)
    match.score_one, match.score_two, match.score_text = payload.score_one, payload.score_two, payload.score_text
    winner = match.player_one_id if payload.score_one > payload.score_two else match.player_two_id
    if staff is not None:
        await finalize_match(session, division, match, winner, correction=correction)
        await audit(session, match.club_id, actor.user_id, "match.corrected" if correction else "match.finalized", "match", str(match.id), payload.audit_reason)
    else:
        await report_for_confirmation(session, division, match, actor, match_sides[1 - my_side])
    await session.commit()
    return match
''')

s = s.replace("OPEN_STATUSES = {EventStatus.published, EventStatus.closed}\n", "OPEN_STATUSES = {EventStatus.published, EventStatus.closed}\nBRACKET_FORMATS = {\"single_elimination\", \"double_elimination\", \"groups_knockout\"}\n", 1)
if "from dataclasses import dataclass" not in s:
    s = s.replace('"""Individual tournament formats: round robin, single elimination and ladder."""\n', '"""Individual tournament formats: round robin, single elimination and ladder."""\nfrom dataclasses import dataclass\n', 1)
open(C, "w").write(s)
print("competitions ok")
