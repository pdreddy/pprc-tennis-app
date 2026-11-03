import os

os.chdir("/app/backend")


def edit(p, pairs, count=1):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:80])
        s = s.replace(a, b) if count == 0 else s.replace(a, b, 1)
    open(p, "w").write(s)


# 1. Background rating recalculation
edit("app/rating_service.py", [
    ('''import asyncio
from collections import defaultdict''', '''import asyncio
import logging
from collections import defaultdict'''),
    ('''from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
''', '''from sqlalchemy import delete, event, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
'''),
    ('''_locks: dict[UUID, asyncio.Lock] = defaultdict(asyncio.Lock)
''', '''_locks: dict[UUID, asyncio.Lock] = defaultdict(asyncio.Lock)
_dirty: set[UUID] = set()
_workers: dict[UUID, asyncio.Task] = {}
logger = logging.getLogger("uvicorn.error")


def rateable(match: RatedMatch) -> bool:
    return bool(match.side_one and match.side_two and match.winner_side in (1, 2) and is_rateable(match.outcome, match.games_one, match.games_two))


def request_recalculation(session: AsyncSession, club_id: UUID, *matches: RatedMatch) -> None:
    """Replay the club in the background once this session commits, so the request returns at once.

    The `rated` flag of the given results is set now so the response is already accurate.
    """
    for match in matches:
        if match.status == "finalized":
            match.rated = rateable(match)
    session.sync_session.info.setdefault("pprc_recalc", set()).add(club_id)


@event.listens_for(Session, "after_commit")
def _queue_after_commit(sync_session: Session) -> None:
    clubs = sync_session.info.pop("pprc_recalc", None)
    if clubs:
        loop = asyncio.get_running_loop()
        for club_id in clubs:
            loop.call_soon(_start_worker, club_id)


@event.listens_for(Session, "after_rollback")
def _drop_after_rollback(sync_session: Session) -> None:
    sync_session.info.pop("pprc_recalc", None)


def _start_worker(club_id: UUID) -> None:
    _dirty.add(club_id)
    if club_id not in _workers:
        _workers[club_id] = asyncio.get_running_loop().create_task(_worker(club_id))


async def _worker(club_id: UUID) -> None:
    """One worker per club; a burst of confirmations collapses into as few replays as possible."""
    from .database import SessionLocal

    try:
        while club_id in _dirty:
            _dirty.discard(club_id)
            try:
                async with SessionLocal() as session:
                    await recalculate_club(session, club_id)
                    await session.commit()
            except Exception:
                logger.exception("background rating recalculation failed for %s", club_id)
    finally:
        _workers.pop(club_id, None)


async def ratings_settled(club_id: UUID | None = None) -> None:
    """Wait for any pending replay (one club, or all) so reads never show half-updated ratings."""
    current = asyncio.current_task()
    tasks = [t for c, t in list(_workers.items()) if (club_id is None or c == club_id) and t is not current]
    if tasks:
        await asyncio.wait(tasks)
'''),
    ('''        for match in matches:
            match.rated = bool(match.side_one and match.side_two and match.winner_side in (1, 2) and is_rateable(match.outcome, match.games_one, match.games_two))''',
     '''        for match in matches:
            match.rated = rateable(match)'''),
    ('''            record.status = "cancelled"
    await session.flush()
    await recalculate_club(session, fixture.club_id)''', '''            record.status = "cancelled"
    await session.flush()
    request_recalculation(session, fixture.club_id, *[r for r in session.new | session.dirty if isinstance(r, RatedMatch)])'''),
    ('''    for key, value in fields.items():
        setattr(record, key, value)
    await session.flush()
    await recalculate_club(session, club_id)''', '''    for key, value in fields.items():
        setattr(record, key, value)
    await session.flush()
    request_recalculation(session, club_id, record)'''),
])

edit("app/ratings.py", [
    ("from .rating_service import milestones_for, recalculate_club, score_fields", "from .rating_service import milestones_for, ratings_settled, recalculate_club, request_recalculation, score_fields"),
    ('''async def membership(session: AsyncSession, club_id: UUID, user_id: str) -> Membership | None:
    return await''', '''async def membership(session: AsyncSession, club_id: UUID, user_id: str) -> Membership | None:
    await ratings_settled(club_id)  # every club read starts here, so it sees finished ratings
    return await'''),
    ('''    record.status, record.confirmed_by = "finalized", actor.user_id
    await session.flush()
    await recalculate_club(session, record.club_id)''', '''    record.status, record.confirmed_by = "finalized", actor.user_id
    await session.flush()
    request_recalculation(session, record.club_id, record)'''),
    ('''    for key, value in fields.items():
        setattr(record, key, value)
    await session.flush()
    await recalculate_club(session, record.club_id)''', '''    for key, value in fields.items():
        setattr(record, key, value)
    await session.flush()
    request_recalculation(session, record.club_id, record)'''),
    ('''    record.status, record.correction_reason = "cancelled", payload.reason
    await session.flush()
    await recalculate_club(session, record.club_id)''', '''    record.status, record.correction_reason = "cancelled", payload.reason
    await session.flush()
    request_recalculation(session, record.club_id, record)'''),
    ('''    club = await session.scalar(select(Club).where(Club.slug == slug))
    profile = club and await session.scalar(''', '''    club = await session.scalar(select(Club).where(Club.slug == slug))
    if club:
        await ratings_settled(club.id)
    profile = club and await session.scalar('''),
    ('''    """Platform-wide ranking across clubs: public profiles and established ratings only."""
''', '''    """Platform-wide ranking across clubs: public profiles and established ratings only."""
    await ratings_settled()
'''),
])
edit("app/challenges.py", [
    ('''    if club is None:
        raise HTTPException(status_code=404, detail="Player not available")
    public =''', '''    if club is None:
        raise HTTPException(status_code=404, detail="Player not available")
    await ratings_settled(club.id)
    public ='''),
    ("from .ratings import ResultInput,", "from .rating_service import ratings_settled\nfrom .ratings import ResultInput,"),
])

# 2. Ladder expiry in the background
edit("app/recaps.py", [
    ('''        except Exception:
            logger.exception("challenge reminders failed")''', '''        except Exception:
            logger.exception("challenge reminders failed")
        try:
            from .competitions import expire_all_ladders

            async with SessionLocal() as session:
                expired = await expire_all_ladders(session)
                if expired:
                    logger.info("ladder deadlines applied in %s division(s)", expired)
        except Exception:
            logger.exception("ladder expiry failed")'''),
])
edit("app/competitions.py", [
    ('''@router.post("/v1/divisions/{division_id}/ladder/challenges",''', '''async def expire_all_ladders(session: AsyncSession) -> int:
    """Background pass: apply every running ladder's challenge deadline without waiting for a page visit."""
    ladders = (await session.scalars(select(Division).join(Event, Event.id == Division.event_id).where(Division.format == "ladder", Event.status.in_(OPEN_STATUSES)))).all()
    changed = 0
    for division in ladders:
        if await expire_stale_challenges(session, division):
            changed += 1
            await session.commit()
    return changed


@router.post("/v1/divisions/{division_id}/ladder/challenges",'''),
    ("    seeds = knockout_seeds(qualifiers)\n", "    seeds = separate_groups(knockout_seeds(qualifiers), {p: i for i, group in enumerate(qualifiers) for p in group})\n"),
    ("    knockout_seeds,\n", "    knockout_seeds,\n    separate_groups,\n"),
])

# 3. Same-group first-round avoidance
edit("app/formats.py", [
    ('''def knockout_seeds(qualifiers_by_group: list[list[str]]) -> list[str]:''', '''def separate_groups(seeds: list[str], group_of: dict[str, int]) -> list[str]:
    """Swap lower seeds so no first-round knockout match pairs two players from the same group.

    Top seeds keep their bracket lines; only the lower player of a clashing match moves. Left as-is when unavoidable.
    """
    size = 1
    while size < len(seeds):
        size *= 2
    order = seed_positions(size)
    pairs = [(order[i], order[i + 1]) for i in range(0, size, 2)]  # (higher seed, lower seed) numbers
    out = list(seeds)
    player = lambda n: out[n - 1] if n <= len(out) else None  # noqa: E731

    def clash(top: int, low: int) -> bool:
        a, b = player(top), player(low)
        return a is not None and b is not None and group_of.get(a) == group_of.get(b)

    for top, low in pairs:
        if not clash(top, low):
            continue
        for other_top, other_low in sorted(pairs, key=lambda p: -p[1]):
            if (other_top, other_low) == (top, low) or player(other_low) is None:
                continue
            out[low - 1], out[other_low - 1] = out[other_low - 1], out[low - 1]
            if not clash(top, low) and not clash(other_top, other_low):
                break
            out[low - 1], out[other_low - 1] = out[other_low - 1], out[low - 1]
    return out


def knockout_seeds(qualifiers_by_group: list[list[str]]) -> list[str]:'''),
])

# 4. Challenge expiry: hard limit from sending by default, optional restart on each new time
edit("app/models.py", [
    ('''    challenge_expiry_days: Mapped[int] = mapped_column(Integer, default=7, server_default="7")
''', '''    challenge_expiry_days: Mapped[int] = mapped_column(Integer, default=7, server_default="7")
    challenge_expiry_restarts: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")  # False: count from when it was sent
'''),
])
edit("app/challenges.py", [
    ('''class SettingsInput(BaseModel):
    challenge_expiry_days: int = Field(ge=3, le=30)
''', '''class SettingsInput(BaseModel):
    challenge_expiry_days: int = Field(ge=3, le=30)
    challenge_expiry_restarts: bool | None = None
'''),
    ('''def challenge_view(c: Challenge, me: str, names: dict[str, str], result_status: str | None, expiry_days: int = 7) -> dict:
    other = c.opponent_id if c.challenger_id == me else c.challenger_id
    started = c.last_action_at or c.created_at''', '''def expiry_start(c: Challenge, restarts: bool) -> datetime | None:
    return (c.last_action_at or c.created_at) if restarts else (c.created_at or c.last_action_at)


def challenge_view(c: Challenge, me: str, names: dict[str, str], result_status: str | None, expiry: tuple[int, bool] = (7, False)) -> dict:
    other = c.opponent_id if c.challenger_id == me else c.challenger_id
    expiry_days, restarts = expiry
    started = expiry_start(c, restarts)'''),
    ('''async def expiry_days(session: AsyncSession, club_id: UUID) -> int:
    return (await session.scalar(select(Club.challenge_expiry_days).where(Club.id == club_id))) or 7''', '''async def expiry_days(session: AsyncSession, club_id: UUID) -> tuple[int, bool]:
    row = (await session.execute(select(Club.challenge_expiry_days, Club.challenge_expiry_restarts).where(Club.id == club_id))).first()
    return (row[0] or 7, bool(row[1])) if row else (7, False)'''),
    ('''    now = now or datetime.now(timezone.utc)
    days = await expiry_days(session, club_id)''', '''    now = now or datetime.now(timezone.utc)
    days, restarts = await expiry_days(session, club_id)'''),
    ('''        started = c.last_action_at or c.created_at
        waiting = c.awaiting_id or c.opponent_id''', '''        started = expiry_start(c, restarts)
        quiet_since = c.last_action_at or c.created_at
        waiting = c.awaiting_id or c.opponent_id'''),
    ('''        elif c.reminded_at is None and now - started >= REMIND_AFTER:''', '''        elif c.reminded_at is None and now - quiet_since >= REMIND_AFTER:'''),
    ('''    await require_member(session, club_id, actor.user_id)
    return {"challenge_expiry_days": await expiry_days(session, club_id), "reminder_after_days": REMIND_AFTER.days}''', '''    await require_member(session, club_id, actor.user_id)
    days, restarts = await expiry_days(session, club_id)
    return {"challenge_expiry_days": days, "challenge_expiry_restarts": restarts, "reminder_after_days": REMIND_AFTER.days}'''),
    ('''    club.challenge_expiry_days = payload.challenge_expiry_days
    await audit(session, club_id, actor.user_id, "club.challenge_expiry", "club", str(club_id), str(payload.challenge_expiry_days))
    await session.commit()
    return {"challenge_expiry_days": club.challenge_expiry_days, "reminder_after_days": REMIND_AFTER.days}''', '''    club.challenge_expiry_days = payload.challenge_expiry_days
    if payload.challenge_expiry_restarts is not None:
        club.challenge_expiry_restarts = payload.challenge_expiry_restarts
    await audit(session, club_id, actor.user_id, "club.challenge_expiry", "club", str(club_id), f"{club.challenge_expiry_days} restarts={club.challenge_expiry_restarts}")
    await session.commit()
    return {"challenge_expiry_days": club.challenge_expiry_days, "challenge_expiry_restarts": bool(club.challenge_expiry_restarts), "reminder_after_days": REMIND_AFTER.days}'''),
])
s = open("app/challenges.py").read()
assert "c.challenger_id, f\"" not in s
print("count expiry_days usages:", s.count("expiry_days("))
open("sql/013_background_and_expiry_mode.sql", "w").write("-- Challenge expiry mode: false counts from when a challenge was sent; true restarts on each new suggested time.\nalter table clubs add column if not exists challenge_expiry_restarts boolean not null default false;\n")
print("ok")
