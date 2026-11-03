"""Individual tournament formats: round robin, single elimination and ladder."""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import Actor, current_actor
from .common import STAFF_ROLES, audit, notify, require_role
from .database import get_session
from .rating_service import sync_competition_result
from .formats import (
    DEAD,
    ENTRY_TYPES,
    FORMAT_CATALOG,
    INDIVIDUAL_FORMATS,
    double_elimination_graph,
    group_count_for,
    group_label,
    knockout_seeds,
    separate_groups,
    snake_groups,
    elimination_round_name,
    elimination_rounds,
    buchholz,
    ladder_after_win,
    round_robin_rounds,
    round_robin_table,
    settle_step,
    swiss_pairings,
    swiss_round_count,
)
from .models import (
    CompetitionMatch,
    Division,
    DivisionEntry,
    Event,
    EventStatus,
    Membership,
    MembershipRole,
)
from .schemas import (
    CompetitionMatchRead,
    CompetitionResult,
    DrawGenerate,
    EntryCreate,
    EntryRead,
    EventRead,
    FixtureDispute,
    FormatRead,
    LadderChallenge,
    PlayerStandingRead,
    TournamentCreate,
    WalkoverRequest,
)

router = APIRouter()
OPEN_STATUSES = {EventStatus.published, EventStatus.closed}
BRACKET_FORMATS = {"single_elimination", "double_elimination", "groups_knockout"}


def validate_individual_rules(format_key: str, rules: dict) -> dict:
    """Merge format defaults into the division rules and validate the configurable values."""
    info = INDIVIDUAL_FORMATS.get(format_key)
    if info is None:
        raise HTTPException(status_code=422, detail=f"Unsupported tournament format: {format_key}")
    merged = {"entryType": "singles", **info.default_rules, **rules}
    try:
        checks = [
            merged["entryType"] in ENTRY_TYPES,
            format_key != "ladder" or 1 <= int(merged["challengeRange"]) <= 10,
            format_key not in {"round_robin", "swiss", "groups_knockout"} or 1 <= int(merged["pointsPerWin"]) <= 10,
            format_key != "swiss" or 0 <= int(merged["swissRounds"]) <= 12,
            format_key != "groups_knockout" or (3 <= int(merged["groupSize"]) <= 8 and 0 <= int(merged["groupCount"]) <= 16 and 1 <= int(merged["advancePerGroup"]) <= 4),
            format_key != "ladder" or 0 <= int(merged["challengeExpiryDays"]) <= 90,
            format_key != "ladder" or merged["challengeExpiryAction"] in {"cancel", "defender_forfeits"},
            format_key not in {"single_elimination", "groups_knockout"} or isinstance(merged["thirdPlaceMatch"], bool),
        ]
        if not all(checks):
            raise ValueError
    except (TypeError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=422, detail="Format rules are out of range") from exc
    return merged


def is_doubles(division: Division) -> bool:
    return division.rules.get("entryType") == "doubles"


async def staff_membership(session: AsyncSession, club_id: UUID, user_id: str) -> Membership | None:
    member = await session.scalar(select(Membership).where(Membership.club_id == club_id, Membership.user_id == user_id))
    return member if member and member.role in STAFF_ROLES else None


async def load_division(session: AsyncSession, division_id: UUID) -> tuple[Division, Event]:
    division = await session.get(Division, division_id)
    if division is None or division.format not in INDIVIDUAL_FORMATS:
        raise HTTPException(status_code=404, detail="Individual-format division not found")
    event = await session.get(Event, division.event_id) if division.event_id else None
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return division, event


def seeding_key(entry: DivisionEntry):
    return (entry.seed is None, entry.seed or 0, entry.rating is None, -float(entry.rating or 0), entry.created_at or datetime.min.replace(tzinfo=timezone.utc))


async def active_entries(session: AsyncSession, division_id: UUID) -> list[DivisionEntry]:
    rows = list((await session.scalars(select(DivisionEntry).where(DivisionEntry.division_id == division_id, DivisionEntry.status == "active"))).all())
    return sorted(rows, key=seeding_key)


async def division_matches(session: AsyncSession, division_id: UUID) -> list[CompetitionMatch]:
    return list((await session.scalars(select(CompetitionMatch).where(CompetitionMatch.division_id == division_id).order_by(CompetitionMatch.round_number, CompetitionMatch.position, CompetitionMatch.created_at))).all())


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


async def reindex_ladder(session: AsyncSession, division_id: UUID) -> None:
    rows = list((await session.scalars(select(DivisionEntry).where(DivisionEntry.division_id == division_id, DivisionEntry.status == "active").order_by(DivisionEntry.rank))).all())
    for index, row in enumerate(rows, start=1):
        row.rank = index


async def sync_entries_for_registration(session: AsyncSession, event: Event, user_id: str, display_name: str, *, active: bool) -> None:
    """Event registration drives entry when the event has exactly one singles-format division."""
    divisions = list((await session.scalars(select(Division).where(Division.event_id == event.id, Division.format.in_(list(INDIVIDUAL_FORMATS))))).all())
    if len(divisions) != 1 or is_doubles(divisions[0]):
        return  # doubles pairs are entered explicitly because they need a partner
    division = divisions[0]
    started = division.format != "ladder" and bool(await session.scalar(select(CompetitionMatch.id).where(CompetitionMatch.division_id == division.id).limit(1)))
    entry = await session.scalar(select(DivisionEntry).where(DivisionEntry.division_id == division.id, DivisionEntry.user_id == user_id))
    if active:
        if started:
            return  # the draw is fixed; organizers add late players explicitly
        if entry is None or entry.status != "active":
            try:
                await ensure_entry(session, division, EntrySpec(user_id, display_name))
            except HTTPException:
                return  # division full: organizers can place the player manually
    elif entry is not None and entry.status == "active":
        await withdraw_player(session, division, entry)


async def sides(session: AsyncSession, match: CompetitionMatch) -> list[set[str]]:
    """User ids on each side of a match, including doubles partners."""
    result: list[set[str]] = []
    for player in (match.player_one_id, match.player_two_id):
        users: set[str] = set()
        if player and player != DEAD:
            users.add(player)
            entry = await session.scalar(select(DivisionEntry).where(DivisionEntry.division_id == match.division_id, DivisionEntry.user_id == player))
            if entry is not None and entry.partner_user_id:
                users.add(entry.partner_user_id)
        result.append(users)
    return result


def side_of(match_sides: list[set[str]], user_id: str | None) -> int | None:
    for index, users in enumerate(match_sides):
        if user_id in users:
            return index
    return None


async def withdrawn_ids(session: AsyncSession, division_id: UUID) -> set[str]:
    return set((await session.scalars(select(DivisionEntry.user_id).where(DivisionEntry.division_id == division_id, DivisionEntry.status == "withdrawn"))).all())


async def forfeit_if_withdrawn(session: AsyncSession, division: Division, match: CompetitionMatch) -> None:
    """A scheduled match against a withdrawn player becomes a walkover for the opponent."""
    if match.status != "scheduled" or division.format == "ladder":
        return
    gone = await withdrawn_ids(session, division.id)
    one_gone, two_gone = match.player_one_id in gone, match.player_two_id in gone
    if one_gone == two_gone:
        return  # neither, or both: an organizer decides
    match.score_one = match.score_two = None
    match.score_text = "W/O"
    await finalize_match(session, division, match, match.player_two_id if one_gone else match.player_one_id, correction=False)


async def withdraw_player(session: AsyncSession, division: Division, entry: DivisionEntry) -> None:
    """Withdraw an entry at any stage; unfinished matches are awarded to the opponent."""
    entry.status = "withdrawn"
    entry.rank = None
    matches = await division_matches(session, division.id)
    if division.format == "ladder":
        # Open challenges involving the player can no longer be played.
        for match in matches:
            if match.status != "finalized" and entry.user_id in {match.player_one_id, match.player_two_id}:
                await session.delete(match)
        await session.flush()
        await reindex_ladder(session, division.id)
        return
    for match in matches:
        if match.status not in {"scheduled", "reported"} or entry.user_id not in {match.player_one_id, match.player_two_id}:
            continue
        if match.status == "reported":
            # Discard the unconfirmed score; the walkover below replaces it.
            match.status, match.reported_by = "scheduled", None
        await forfeit_if_withdrawn(session, division, match)


@router.get("/v1/formats", response_model=list[FormatRead])
async def list_formats() -> list[dict]:
    return FORMAT_CATALOG


@router.post("/v1/clubs/{club_id}/tournaments", response_model=EventRead, status_code=status.HTTP_201_CREATED)
async def create_tournament(club_id: UUID, payload: TournamentCreate, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> Event:
    """Create an event and its first division for round robin, single elimination or ladder play."""
    await require_role(session, club_id, actor.user_id, STAFF_ROLES)
    rules = validate_individual_rules(payload.division.format, payload.division.rules)
    if payload.division.capacity > payload.event.capacity:
        raise HTTPException(status_code=422, detail="Division capacity cannot exceed event capacity")
    event = Event(club_id=club_id, **payload.event.model_dump())
    session.add(event)
    await session.flush()
    division = Division(club_id=club_id, event_id=event.id, **{**payload.division.model_dump(), "rules": rules})
    session.add(division)
    await session.flush()
    await audit(session, club_id, actor.user_id, "tournament.created", "event", str(event.id), payload.division.format)
    await audit(session, club_id, actor.user_id, "division.created", "division", str(division.id))
    await session.commit()
    return event


@router.get("/v1/divisions/{division_id}/entries", response_model=list[EntryRead])
async def list_entries(division_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[DivisionEntry]:
    division, _ = await load_division(session, division_id)
    await require_role(session, division.club_id, actor.user_id, set(MembershipRole))
    if await expire_stale_challenges(session, division):
        await session.commit()
    rows = list((await session.scalars(select(DivisionEntry).where(DivisionEntry.division_id == division_id))).all())
    if division.format == "ladder":
        return sorted(rows, key=lambda r: (r.status != "active", r.rank or 10**6))
    return sorted(rows, key=lambda r: (r.status != "active", *seeding_key(r)))


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


async def add_late_round_robin_matches(session: AsyncSession, division: Division, entry: DivisionEntry) -> None:
    """A late round-robin entrant gets one new match against every other active player."""
    matches = await division_matches(session, division.id)
    round_number = max((m.round_number for m in matches), default=0) + 1
    opponents = [e for e in await active_entries(session, division.id) if e.user_id != entry.user_id]
    session.add_all([
        new_match(division, round_number=round_number, round_name="late_entry", position=position, player_one_id=opponent.user_id, player_two_id=entry.user_id, status="scheduled")
        for position, opponent in enumerate(opponents)
    ])
    for person in {entry.user_id, entry.partner_user_id} - {None}:
        await notify(session, division.club_id, person, "match", "You have been added to the draw", f"{len(opponents)} matches were scheduled for you.", {"divisionId": str(division.id)})


@router.post("/v1/entries/{entry_id}/withdraw", response_model=EntryRead)
async def withdraw_entry(entry_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> DivisionEntry:
    """Withdraw before or after the draw; unfinished matches are awarded to the opponent as walkovers."""
    entry = await session.get(DivisionEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    if actor.user_id not in {entry.user_id, entry.partner_user_id}:
        await require_role(session, entry.club_id, actor.user_id, STAFF_ROLES)
    division = await session.get(Division, entry.division_id)
    if entry.status == "withdrawn":
        return entry
    event = await session.get(Event, division.event_id)
    if event and event.status == EventStatus.completed:
        raise HTTPException(status_code=409, detail="Completed events cannot change")
    await withdraw_player(session, division, entry)
    await audit(session, entry.club_id, actor.user_id, "entry.withdrawn", "entry", str(entry.id))
    await session.commit()
    return entry


def place(match: CompetitionMatch, slot: int, player: str | None) -> None:
    if slot == 0:
        match.player_one_id = player
    else:
        match.player_two_id = player


def new_match(division: Division, **values) -> CompetitionMatch:
    return CompetitionMatch(id=uuid4(), club_id=division.club_id, division_id=division.id, **values)


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

    builder = DRAW_BUILDERS.get(division.format)
    if builder is None:
        raise HTTPException(status_code=422, detail=f"Unsupported division format: {division.format}")
    matches = await builder(session, division, entries, when)
    await audit(session, division.club_id, actor.user_id, "draw.generated", "division", str(division.id), division.format)
    await session.commit()
    return [match for match in matches if match.status != "dead"]


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


def swiss_round(division: Division, round_number: int, order: list[str], wins: dict[str, int], played: set, had_bye: set, starts_at: datetime | None) -> list[CompetitionMatch]:
    pairs, bye = swiss_pairings(order, wins, played, had_bye)
    matches = [new_match(division, round_number=round_number, round_name=f"round_{round_number}", position=position, player_one_id=one, player_two_id=two, status="scheduled", starts_at=starts_at) for position, (one, two) in enumerate(pairs)]
    if bye:
        matches.append(new_match(division, round_number=round_number, round_name=f"round_{round_number}", position=len(pairs), player_one_id=bye, player_two_id=None, winner_id=bye, status="bye", starts_at=starts_at))
    return matches


@router.post("/v1/divisions/{division_id}/swiss/next-round", response_model=list[CompetitionMatchRead], status_code=status.HTTP_201_CREATED)
async def swiss_next_round(division_id: UUID, payload: DrawGenerate, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[CompetitionMatch]:
    division, event = await load_division(session, division_id)
    if division.format != "swiss":
        raise HTTPException(status_code=422, detail="Only Swiss divisions have rounds")
    await require_role(session, division.club_id, actor.user_id, STAFF_ROLES)
    if event.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="The event is not running")
    matches = await division_matches(session, division.id)
    if not matches:
        raise HTTPException(status_code=409, detail="Generate the first round first")
    current = max(m.round_number for m in matches)
    total = int(division.rules.get("swissRounds") or 0)
    if current >= total:
        raise HTTPException(status_code=409, detail="All Swiss rounds have been generated")
    if any(m.round_number == current and m.status not in {"finalized", "bye"} for m in matches):
        raise HTTPException(status_code=409, detail="Finish every match in the current round first")
    entries = await active_entries(session, division.id)
    if len(entries) < 2:
        raise HTTPException(status_code=422, detail="At least two active players are needed")
    wins: dict[str, int] = {}
    played: set = set()
    had_bye: set = set()
    for m in matches:
        if m.status == "bye":
            had_bye.add(m.player_one_id)
            wins[m.player_one_id] = wins.get(m.player_one_id, 0) + 1
        elif m.status == "finalized":
            played.add(frozenset((m.player_one_id, m.player_two_id)))
            if m.winner_id:
                wins[m.winner_id] = wins.get(m.winner_id, 0) + 1
    created = swiss_round(division, current + 1, [e.user_id for e in entries], wins, played, had_bye, payload.starts_at)
    session.add_all(created)
    await audit(session, division.club_id, actor.user_id, "swiss.round_generated", "division", str(division.id), str(current + 1))
    await session.commit()
    return created


@router.get("/v1/divisions/{division_id}/competition-matches", response_model=list[CompetitionMatchRead])
async def list_competition_matches(division_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[CompetitionMatch]:
    division, _ = await load_division(session, division_id)
    await require_role(session, division.club_id, actor.user_id, set(MembershipRole))
    if await expire_stale_challenges(session, division):
        await session.commit()
    return [m for m in await division_matches(session, division_id) if m.status != "dead"]


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


async def rate_competition_match(session: AsyncSession, division: Division, match: CompetitionMatch, winner: str) -> None:
    """Feed the verified result into PPRC Rating (walkovers are stored but never rated)."""
    if not match.player_one_id or not match.player_two_id or DEAD in {match.player_one_id, match.player_two_id}:
        return
    one, two = await sides(session, match)
    now = datetime.now(timezone.utc)
    played_at = match.starts_at if match.starts_at and match.starts_at <= now else now
    await sync_competition_result(
        session, division.club_id, division.id, match.id, sorted(one), sorted(two),
        winner_side=1 if winner == match.player_one_id else 2, score_text=match.score_text,
        score_one=match.score_one, score_two=match.score_two, played_at=played_at, doubles=is_doubles(division),
    )


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


async def settle(session: AsyncSession, division: Division, match: CompetitionMatch) -> None:
    """Resolve byes and unplayable matches in a double-elimination bracket, following the routes."""
    if match.status != "pending":
        return
    verdict, winner = settle_step(match.player_one_id, match.player_two_id)
    if verdict == "wait":
        return
    if verdict == "scheduled":
        match.status = "scheduled"
        await forfeit_if_withdrawn(session, division, match)
        return
    match.status, match.winner_id = verdict, winner
    for target_id, slot, person in ((match.next_match_id, match.next_slot, winner), (match.loser_match_id, match.loser_slot, DEAD)):
        if target_id:
            target = await session.get(CompetitionMatch, target_id)
            place(target, slot or 0, person)
            await settle(session, division, target)


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


@router.post("/v1/competition-matches/{match_id}/confirm", response_model=CompetitionMatchRead)
async def confirm_result(match_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> CompetitionMatch:
    match = await session.get(CompetitionMatch, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    division, event = await load_division(session, match.division_id)
    if event.status == EventStatus.completed:
        raise HTTPException(status_code=409, detail="Completed events cannot accept score changes")
    if match.status != "reported":
        raise HTTPException(status_code=409, detail="Only a reported score can be confirmed")
    match_sides = await sides(session, match)
    mine, theirs = side_of(match_sides, actor.user_id), side_of(match_sides, match.reported_by)
    if mine is None or mine == theirs:
        raise HTTPException(status_code=403, detail="The opposing player must confirm this score")
    winner = match.player_one_id if (match.score_one or 0) > (match.score_two or 0) else match.player_two_id
    await finalize_match(session, division, match, winner, correction=False)
    await audit(session, match.club_id, actor.user_id, "match.confirmed", "match", str(match.id))
    await session.commit()
    return match


@router.post("/v1/competition-matches/{match_id}/dispute", response_model=CompetitionMatchRead)
async def dispute_result(match_id: UUID, payload: FixtureDispute, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> CompetitionMatch:
    """The opposing side rejects a reported score; the match reopens for an organizer or a new report."""
    match = await session.get(CompetitionMatch, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status != "reported":
        raise HTTPException(status_code=409, detail="Only a reported score can be disputed")
    match_sides = await sides(session, match)
    mine, theirs = side_of(match_sides, actor.user_id), side_of(match_sides, match.reported_by)
    if mine is None or mine == theirs:
        raise HTTPException(status_code=403, detail="The opposing player must raise a dispute")
    match.status, match.score_one, match.score_two, match.score_text, match.reported_by = "scheduled", None, None, None, None
    await audit(session, match.club_id, actor.user_id, "match.disputed", "match", str(match.id), payload.reason)
    await session.commit()
    return match


@router.post("/v1/competition-matches/{match_id}/walkover", response_model=CompetitionMatchRead)
async def record_walkover(match_id: UUID, payload: WalkoverRequest, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> CompetitionMatch:
    """Organizer awards a match to one side (no-show, injury, late withdrawal) with an audit reason."""
    match = await session.get(CompetitionMatch, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    division, event = await load_division(session, match.division_id)
    await require_role(session, match.club_id, actor.user_id, STAFF_ROLES)
    if event.status == EventStatus.completed:
        raise HTTPException(status_code=409, detail="Completed events cannot accept score changes")
    if match.status not in {"scheduled", "reported"}:
        raise HTTPException(status_code=409, detail="Only a scheduled or reported match can be awarded as a walkover")
    if payload.winner_id not in {match.player_one_id, match.player_two_id}:
        raise HTTPException(status_code=422, detail="The winner must be one of the two sides")
    match.score_one = match.score_two = None
    match.score_text, match.reported_by = "W/O", None
    await finalize_match(session, division, match, payload.winner_id, correction=False)
    await audit(session, match.club_id, actor.user_id, "match.walkover", "match", str(match.id), payload.reason)
    await session.commit()
    return match


async def expire_stale_challenges(session: AsyncSession, division: Division) -> bool:
    """Apply the ladder's challenge deadline: cancel, or award the challenger, and auto-confirm stale reports."""
    days = int(division.rules.get("challengeExpiryDays", 0) or 0)
    if division.format != "ladder" or days <= 0:
        return False
    now = datetime.now(timezone.utc)
    changed = False
    for match in await division_matches(session, division.id):
        if match.round_name != "challenge" or match.status not in {"scheduled", "reported"}:
            continue
        started = max((value for value in (match.created_at, match.starts_at) if value is not None), default=now)
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        if started + timedelta(days=days) > now:
            continue
        changed = True
        if match.status == "reported":
            winner = match.player_one_id if (match.score_one or 0) > (match.score_two or 0) else match.player_two_id
            await finalize_match(session, division, match, winner, correction=False)
            await audit(session, division.club_id, "system", "ladder.report_auto_confirmed", "match", str(match.id))
        elif division.rules.get("challengeExpiryAction") == "defender_forfeits":
            match.score_one = match.score_two = None
            match.score_text = "W/O (expired)"
            await finalize_match(session, division, match, match.player_one_id, correction=False)
            await audit(session, division.club_id, "system", "ladder.challenge_forfeited", "match", str(match.id))
        else:
            await audit(session, division.club_id, "system", "ladder.challenge_expired", "match", str(match.id))
            await session.delete(match)
    return changed


async def expire_all_ladders(session: AsyncSession) -> int:
    """Background pass: apply every running ladder's challenge deadline without waiting for a page visit."""
    ladders = (await session.scalars(select(Division).join(Event, Event.id == Division.event_id).where(Division.format == "ladder", Event.status.in_(OPEN_STATUSES)))).all()
    changed = 0
    for division in ladders:
        if await expire_stale_challenges(session, division):
            changed += 1
            await session.commit()
    return changed


@router.post("/v1/divisions/{division_id}/ladder/challenges", response_model=CompetitionMatchRead, status_code=status.HTTP_201_CREATED)
async def create_challenge(division_id: UUID, payload: LadderChallenge, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> CompetitionMatch:
    division, event = await load_division(session, division_id)
    if division.format != "ladder":
        raise HTTPException(status_code=422, detail="Challenges are only available on ladders")
    if event.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="The ladder is not open")
    await expire_stale_challenges(session, division)
    await session.flush()
    entries = await active_entries(session, division.id)
    challenger = next((e for e in entries if actor.user_id in {e.user_id, e.partner_user_id}), None)
    defender = next((e for e in entries if e.user_id == payload.opponent_id), None)
    if challenger is None:
        raise HTTPException(status_code=403, detail="Join the ladder before challenging")
    if defender is None or defender.user_id == challenger.user_id:
        raise HTTPException(status_code=404, detail="Opponent is not on the ladder")
    reach = int(division.rules.get("challengeRange", 3))
    if not (defender.rank or 0) < (challenger.rank or 0) or (challenger.rank or 0) - (defender.rank or 0) > reach:
        raise HTTPException(status_code=422, detail=f"You can only challenge players up to {reach} places above you")
    open_matches = [m for m in await division_matches(session, division.id) if m.status != "finalized"]
    if any({challenger.user_id, defender.user_id} & {m.player_one_id, m.player_two_id} for m in open_matches):
        raise HTTPException(status_code=409, detail="One of the players already has an open challenge")
    total = len(await division_matches(session, division.id))
    match = new_match(division, round_number=total + 1, round_name="challenge", position=0, player_one_id=challenger.user_id, player_two_id=defender.user_id, status="scheduled", starts_at=payload.starts_at)
    session.add(match)
    for person in {defender.user_id, defender.partner_user_id} - {None}:
        await notify(session, division.club_id, person, "match", "You have been challenged", f"{challenger.display_name} challenged you on the ladder.", {"matchId": str(match.id), "divisionId": str(division.id)})
    await audit(session, division.club_id, actor.user_id, "ladder.challenged", "match", str(match.id))
    await session.commit()
    return match


@router.post("/v1/competition-matches/{match_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_challenge(match_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> None:
    match = await session.get(CompetitionMatch, match_id)
    if match is None or match.round_name != "challenge":
        raise HTTPException(status_code=404, detail="Challenge not found")
    if match.status == "finalized":
        raise HTTPException(status_code=409, detail="Finalized challenges cannot be cancelled")
    if side_of(await sides(session, match), actor.user_id) != 0:
        await require_role(session, match.club_id, actor.user_id, STAFF_ROLES)
    await audit(session, match.club_id, actor.user_id, "ladder.challenge_cancelled", "match", str(match.id))
    await session.delete(match)
    await session.commit()
