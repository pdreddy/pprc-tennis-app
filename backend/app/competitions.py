"""Individual tournament formats: round robin, single elimination and ladder."""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import Actor, current_actor
from .common import STAFF_ROLES, audit, notify, require_role
from .database import get_session
from .formats import (
    FORMAT_CATALOG,
    INDIVIDUAL_FORMATS,
    elimination_round_name,
    elimination_rounds,
    ladder_after_win,
    round_robin_rounds,
    round_robin_table,
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
)

router = APIRouter()
OPEN_STATUSES = {EventStatus.published, EventStatus.closed}


def validate_individual_rules(format_key: str, rules: dict) -> dict:
    """Merge format defaults into the division rules and validate the configurable values."""
    info = INDIVIDUAL_FORMATS.get(format_key)
    if info is None:
        raise HTTPException(status_code=422, detail=f"Unsupported tournament format: {format_key}")
    merged = {**info.default_rules, **rules}
    try:
        if format_key == "ladder" and not 1 <= int(merged["challengeRange"]) <= 10:
            raise ValueError
        if format_key == "round_robin" and not 1 <= int(merged["pointsPerWin"]) <= 10:
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Format rules are out of range") from exc
    return merged


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


async def ensure_entry(session: AsyncSession, division: Division, user_id: str, display_name: str, rating: float | None = None, seed: int | None = None) -> DivisionEntry:
    """Create or reactivate an entry. Caller has already checked permissions and event state."""
    entry = await session.scalar(select(DivisionEntry).where(DivisionEntry.division_id == division.id, DivisionEntry.user_id == user_id))
    if entry is not None and entry.status == "active":
        raise HTTPException(status_code=409, detail="Already entered in this division")
    count = int(await session.scalar(select(func.count()).select_from(DivisionEntry).where(DivisionEntry.division_id == division.id, DivisionEntry.status == "active")) or 0)
    if count >= division.capacity:
        raise HTTPException(status_code=409, detail="Division is full")
    if entry is None:
        entry = DivisionEntry(club_id=division.club_id, division_id=division.id, user_id=user_id, display_name=display_name)
        session.add(entry)
    entry.status = "active"
    entry.display_name = display_name
    if rating is not None:
        entry.rating = rating
    if seed is not None:
        entry.seed = seed
    if division.format == "ladder":
        entry.rank = int(await session.scalar(select(func.coalesce(func.max(DivisionEntry.rank), 0)).where(DivisionEntry.division_id == division.id, DivisionEntry.status == "active")) or 0) + 1
    await session.flush()
    return entry


async def reindex_ladder(session: AsyncSession, division_id: UUID) -> None:
    rows = list((await session.scalars(select(DivisionEntry).where(DivisionEntry.division_id == division_id, DivisionEntry.status == "active").order_by(DivisionEntry.rank))).all())
    for index, row in enumerate(rows, start=1):
        row.rank = index


async def sync_entries_for_registration(session: AsyncSession, event: Event, user_id: str, display_name: str, *, active: bool) -> None:
    """Event registration drives entry when the event has exactly one individual-format division."""
    divisions = list((await session.scalars(select(Division).where(Division.event_id == event.id, Division.format.in_(list(INDIVIDUAL_FORMATS))))).all())
    if len(divisions) != 1:
        return
    division = divisions[0]
    started = division.format != "ladder" and bool(await session.scalar(select(CompetitionMatch.id).where(CompetitionMatch.division_id == division.id).limit(1)))
    if started:
        return  # the draw is fixed; organizers add or withdraw players explicitly
    entry = await session.scalar(select(DivisionEntry).where(DivisionEntry.division_id == division.id, DivisionEntry.user_id == user_id))
    if active:
        if entry is None or entry.status != "active":
            try:
                await ensure_entry(session, division, user_id, display_name)
            except HTTPException:
                return  # division full: organizers can place the player manually
    elif entry is not None and entry.status == "active":
        entry.status = "withdrawn"
        entry.rank = None
        if division.format == "ladder":
            await session.flush()
            await reindex_ladder(session, division.id)


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
    rows = list((await session.scalars(select(DivisionEntry).where(DivisionEntry.division_id == division_id))).all())
    if division.format == "ladder":
        return sorted(rows, key=lambda r: (r.status != "active", r.rank or 10**6))
    return sorted(rows, key=lambda r: (r.status != "active", *seeding_key(r)))


@router.post("/v1/divisions/{division_id}/entries", response_model=EntryRead, status_code=status.HTTP_201_CREATED)
async def add_entry(division_id: UUID, payload: EntryCreate, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> DivisionEntry:
    """Players enter themselves while registration is open; organizers can enter anyone."""
    division, event = await load_division(session, division_id)
    staff = await staff_membership(session, division.club_id, actor.user_id)
    target = payload.user_id or actor.user_id
    if event.status == EventStatus.completed or event.status == EventStatus.draft and staff is None:
        raise HTTPException(status_code=409, detail="Event is not open for entries")
    if target != actor.user_id and staff is None:
        raise HTTPException(status_code=403, detail="Only organizers can enter other players")
    if staff is None:
        if event.status != EventStatus.published:
            raise HTTPException(status_code=409, detail="Event is not open for entries")
        closes_at = event.rules.get("registrationClose")
        if closes_at:
            try:
                close_time = datetime.fromisoformat(str(closes_at).replace("Z", "+00:00"))
            except ValueError:
                close_time = None
            if close_time is not None:
                if close_time.tzinfo is None:
                    close_time = close_time.replace(tzinfo=timezone.utc)
                if close_time <= datetime.now(timezone.utc):
                    raise HTTPException(status_code=409, detail="Registration has closed")
    if division.format != "ladder" and await session.scalar(select(CompetitionMatch.id).where(CompetitionMatch.division_id == division.id).limit(1)):
        raise HTTPException(status_code=409, detail="The draw has already been generated")
    membership = await session.scalar(select(Membership).where(Membership.club_id == division.club_id, Membership.user_id == target))
    if membership is None:
        membership = Membership(club_id=division.club_id, user_id=target, display_name=payload.display_name or (actor.name if target == actor.user_id else None) or target)
        session.add(membership)
    name = payload.display_name or membership.display_name or target
    if staff is None and (payload.rating is not None or payload.seed is not None):
        raise HTTPException(status_code=403, detail="Only organizers can set ratings and seeds")
    entry = await ensure_entry(session, division, target, name, payload.rating, payload.seed)
    await audit(session, division.club_id, actor.user_id, "entry.created", "entry", str(entry.id))
    await session.commit()
    return entry


@router.post("/v1/entries/{entry_id}/withdraw", response_model=EntryRead)
async def withdraw_entry(entry_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> DivisionEntry:
    entry = await session.get(DivisionEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    if entry.user_id != actor.user_id:
        await require_role(session, entry.club_id, actor.user_id, STAFF_ROLES)
    division = await session.get(Division, entry.division_id)
    if entry.status == "withdrawn":
        return entry
    if division.format != "ladder" and await session.scalar(select(CompetitionMatch.id).where(CompetitionMatch.division_id == division.id).limit(1)):
        raise HTTPException(status_code=409, detail="The draw is fixed; ask an organizer to record a walkover")
    entry.status = "withdrawn"
    entry.rank = None
    if division.format == "ladder":
        # Open challenges involving the player can no longer be played.
        for match in await division_matches(session, division.id):
            if match.status != "finalized" and entry.user_id in {match.player_one_id, match.player_two_id}:
                await session.delete(match)
        await session.flush()
        await reindex_ladder(session, division.id)
    await audit(session, entry.club_id, actor.user_id, "entry.withdrawn", "entry", str(entry.id))
    await session.commit()
    return entry


def place_in_next(next_match: CompetitionMatch, slot: int, player: str | None) -> None:
    if slot == 0:
        next_match.player_one_id = player
    else:
        next_match.player_two_id = player
    if next_match.player_one_id and next_match.player_two_id and next_match.status == "pending":
        next_match.status = "scheduled"


@router.post("/v1/divisions/{division_id}/draw", response_model=list[CompetitionMatchRead], status_code=status.HTTP_201_CREATED)
async def generate_draw(division_id: UUID, payload: DrawGenerate, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[CompetitionMatch]:
    """Round robin schedule, elimination bracket, or the initial ladder ranking."""
    division, event = await load_division(session, division_id)
    await require_role(session, division.club_id, actor.user_id, STAFF_ROLES)
    if event.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="Open registration before generating the draw")
    if await session.scalar(select(CompetitionMatch.id).where(CompetitionMatch.division_id == division.id).limit(1)):
        raise HTTPException(status_code=409, detail="A draw or challenges already exist for this division")
    entries = await active_entries(session, division.id)
    if len(entries) < 2:
        raise HTTPException(status_code=422, detail="At least two players are needed")
    players = [entry.user_id for entry in entries]
    matches: list[CompetitionMatch] = []
    if division.format == "ladder":
        for index, entry in enumerate(entries, start=1):
            entry.rank = index
    elif division.format == "round_robin":
        for round_index, pairs in enumerate(round_robin_rounds(players), start=1):
            for position, (one, two) in enumerate(pairs):
                matches.append(CompetitionMatch(
                    id=uuid4(), club_id=division.club_id, division_id=division.id, round_number=round_index,
                    round_name=f"round_{round_index}", position=position, player_one_id=one, player_two_id=two,
                    status="scheduled", starts_at=payload.starts_at + timedelta(days=7 * (round_index - 1)) if payload.starts_at else None,
                ))
        session.add_all(matches)
    else:
        rounds = elimination_rounds(players)
        grid: list[list[CompetitionMatch]] = []
        for round_number, pairs in enumerate(rounds, start=1):
            row = [CompetitionMatch(
                id=uuid4(), club_id=division.club_id, division_id=division.id, round_number=round_number,
                round_name=elimination_round_name(round_number, len(rounds)), position=position,
                player_one_id=one, player_two_id=two, status="pending",
                starts_at=payload.starts_at + timedelta(days=7 * (round_number - 1)) if payload.starts_at else None,
            ) for position, (one, two) in enumerate(pairs)]
            grid.append(row)
        for round_index, row in enumerate(grid[:-1]):
            for position, match in enumerate(row):
                match.next_match_id = grid[round_index + 1][position // 2].id
                match.next_slot = position % 2
        # Later rounds are inserted first so next_match_id always points at an existing row.
        session.add_all([match for row in reversed(grid) for match in row])
        await session.flush()
        for match in grid[0]:
            if match.player_one_id and match.player_two_id:
                match.status = "scheduled"
            else:
                # A bye: the lone player advances without playing.
                winner = match.player_one_id or match.player_two_id
                match.status, match.winner_id = "bye", winner
                nxt = next(m for m in grid[1] if m.id == match.next_match_id)
                place_in_next(nxt, match.next_slot or 0, winner)
        matches = [match for row in grid for match in row]
    await audit(session, division.club_id, actor.user_id, "draw.generated", "division", str(division.id), division.format)
    await session.commit()
    return matches


@router.get("/v1/divisions/{division_id}/competition-matches", response_model=list[CompetitionMatchRead])
async def list_competition_matches(division_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[CompetitionMatch]:
    division, _ = await load_division(session, division_id)
    await require_role(session, division.club_id, actor.user_id, set(MembershipRole))
    return await division_matches(session, division_id)


@router.get("/v1/divisions/{division_id}/player-standings", response_model=list[PlayerStandingRead])
async def player_standings(division_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[PlayerStandingRead]:
    division, _ = await load_division(session, division_id)
    await require_role(session, division.club_id, actor.user_id, set(MembershipRole))
    entries = list((await session.scalars(select(DivisionEntry).where(DivisionEntry.division_id == division_id))).all())
    names = {entry.user_id: entry.display_name for entry in entries}
    matches = [m for m in await division_matches(session, division_id) if m.status == "finalized" and m.winner_id]
    table = round_robin_table(
        [entry.user_id for entry in entries if entry.status == "active"],
        [(m.player_one_id, m.player_two_id, m.winner_id) for m in matches],
        int(division.rules.get("pointsPerWin", 2)),
    )
    return [PlayerStandingRead(display_name=names.get(row["subject_id"], row["subject_id"]), **row) for row in table]


async def finalize_match(session: AsyncSession, division: Division, match: CompetitionMatch, winner: str, actor_id: str, *, correction: bool) -> None:
    previous_winner = match.winner_id
    match.winner_id, match.status = winner, "finalized"
    if division.format == "single_elimination" and match.next_match_id:
        nxt = await session.get(CompetitionMatch, match.next_match_id)
        if correction and previous_winner != winner and nxt.status in {"reported", "finalized"}:
            raise HTTPException(status_code=409, detail="The next round has already been played; correct that result first")
        place_in_next(nxt, match.next_slot or 0, winner)
    if division.format == "ladder" and match.round_name == "challenge" and winner == match.player_one_id:
        entries = list((await session.scalars(select(DivisionEntry).where(DivisionEntry.division_id == division.id, DivisionEntry.status == "active"))).all())
        by_user = {entry.user_id: entry for entry in entries}
        order = [entry.user_id for entry in sorted(entries, key=lambda e: e.rank or 10**6)]
        if match.player_one_id in by_user and match.player_two_id in by_user:
            for index, user_id in enumerate(ladder_after_win(order, match.player_one_id, match.player_two_id), start=1):
                by_user[user_id].rank = index


@router.post("/v1/competition-matches/{match_id}/result", response_model=CompetitionMatchRead)
async def submit_result(match_id: UUID, payload: CompetitionResult, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> CompetitionMatch:
    """Organizers finalize a score; a participant reports it and the opponent confirms."""
    match = await session.get(CompetitionMatch, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    division, event = await load_division(session, match.division_id)
    if event.status == EventStatus.completed:
        raise HTTPException(status_code=409, detail="Completed events cannot accept score changes")
    staff = await staff_membership(session, match.club_id, actor.user_id)
    players = {match.player_one_id, match.player_two_id} - {None}
    if staff is None and actor.user_id not in players:
        raise HTTPException(status_code=403, detail="Only participants or organizers can submit this score")
    if match.status in {"pending", "bye"} or len(players) < 2:
        raise HTTPException(status_code=409, detail="This match is not ready to be played")
    if payload.score_one == payload.score_two:
        raise HTTPException(status_code=422, detail="Matches cannot end in a tie")
    correction = match.status == "finalized"
    if correction:
        if staff is None:
            raise HTTPException(status_code=409, detail="Finalized scores need an organizer correction")
        if division.format == "ladder":
            raise HTTPException(status_code=409, detail="Ladder results cannot be corrected because ranks have already moved")
        if not payload.audit_reason:
            raise HTTPException(status_code=422, detail="A correction needs an audit reason")
    if match.status == "reported" and staff is None and match.reported_by != actor.user_id:
        raise HTTPException(status_code=409, detail="Awaiting the opponent's confirmation or dispute")
    match.score_one, match.score_two, match.score_text = payload.score_one, payload.score_two, payload.score_text
    winner = match.player_one_id if payload.score_one > payload.score_two else match.player_two_id
    if staff is not None:
        await finalize_match(session, division, match, winner, actor.user_id, correction=correction)
        await audit(session, match.club_id, actor.user_id, "match.corrected" if correction else "match.finalized", "match", str(match.id), payload.audit_reason)
    else:
        match.status, match.reported_by = "reported", actor.user_id
        other = match.player_two_id if actor.user_id == match.player_one_id else match.player_one_id
        await notify(session, match.club_id, other, "match", "Score awaiting confirmation", "Your opponent reported a score that needs your confirmation.", {"matchId": str(match.id), "divisionId": str(division.id)})
        await audit(session, match.club_id, actor.user_id, "match.reported", "match", str(match.id))
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
    if actor.user_id == match.reported_by or actor.user_id not in {match.player_one_id, match.player_two_id}:
        raise HTTPException(status_code=403, detail="The opposing player must confirm this score")
    winner = match.player_one_id if (match.score_one or 0) > (match.score_two or 0) else match.player_two_id
    await finalize_match(session, division, match, winner, actor.user_id, correction=False)
    await audit(session, match.club_id, actor.user_id, "match.confirmed", "match", str(match.id))
    await session.commit()
    return match


@router.post("/v1/competition-matches/{match_id}/dispute", response_model=CompetitionMatchRead)
async def dispute_result(match_id: UUID, payload: FixtureDispute, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> CompetitionMatch:
    """The opponent rejects a reported score; the match reopens for an organizer or a new report."""
    match = await session.get(CompetitionMatch, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    if match.status != "reported":
        raise HTTPException(status_code=409, detail="Only a reported score can be disputed")
    if actor.user_id == match.reported_by or actor.user_id not in {match.player_one_id, match.player_two_id}:
        raise HTTPException(status_code=403, detail="The opposing player must raise a dispute")
    match.status, match.score_one, match.score_two, match.score_text, match.reported_by = "scheduled", None, None, None, None
    await audit(session, match.club_id, actor.user_id, "match.disputed", "match", str(match.id), payload.reason)
    await session.commit()
    return match


@router.post("/v1/divisions/{division_id}/ladder/challenges", response_model=CompetitionMatchRead, status_code=status.HTTP_201_CREATED)
async def create_challenge(division_id: UUID, payload: LadderChallenge, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> CompetitionMatch:
    division, event = await load_division(session, division_id)
    if division.format != "ladder":
        raise HTTPException(status_code=422, detail="Challenges are only available on ladders")
    if event.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="The ladder is not open")
    entries = {entry.user_id: entry for entry in await active_entries(session, division.id)}
    challenger, defender = entries.get(actor.user_id), entries.get(payload.opponent_id)
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
    match = CompetitionMatch(
        id=uuid4(), club_id=division.club_id, division_id=division.id, round_number=total + 1, round_name="challenge",
        position=0, player_one_id=challenger.user_id, player_two_id=defender.user_id, status="scheduled", starts_at=payload.starts_at,
    )
    session.add(match)
    await notify(session, division.club_id, defender.user_id, "match", "You have been challenged", f"{challenger.display_name} challenged you on the ladder.", {"matchId": str(match.id), "divisionId": str(division.id)})
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
    if actor.user_id != match.player_one_id:
        await require_role(session, match.club_id, actor.user_id, STAFF_ROLES)
    await audit(session, match.club_id, actor.user_id, "ladder.challenge_cancelled", "match", str(match.id))
    await session.delete(match)
    await session.commit()
