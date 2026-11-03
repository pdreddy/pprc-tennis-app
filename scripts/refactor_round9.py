"""Split h2h/rivalries into helpers, break the common <-> rating_service import cycle, type models."""
import os

os.chdir("/app/backend")


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b, 1)
    open(p, "w").write(s)


def replace_block(path, start, new):
    s = open(path).read()
    i = s.index(start)
    j = s.find("\n\n\n", i)
    s = s[:i] + new.strip("\n") + (s[j:] if j != -1 else "\n")
    open(path, "w").write(s)


replace_block("app/challenges.py", '@router.get("/v1/clubs/{club_id}/rivalries")', '''
def rivalry_tally(rows: list[RatedMatch], names: dict[str, str], hidden: set[str]) -> tuple[dict, dict]:
    """Wins per (sorted) pair of opponents and their latest meeting."""
    tally: dict[tuple[str, str], list[int]] = {}
    last: dict[tuple[str, str], datetime] = {}
    for m in rows:
        if m.winner_side not in (1, 2):
            continue
        pairs = [(one, two) for one in m.side_one for two in m.side_two if one not in hidden and two not in hidden and one in names and two in names]
        for one, two in pairs:
            a, b = sorted((one, two))
            wins = tally.setdefault((a, b), [0, 0])
            wins[0 if (m.winner_side == 1) == (a in m.side_one) else 1] += 1
            last[(a, b)] = max(last.get((a, b), m.played_at), m.played_at)
    return tally, last


def rivalry_rows(tally: dict, last: dict, names: dict[str, str]) -> list[dict]:
    """Pairs with 2+ meetings, leader first."""
    rows = []
    for (a, b), (a_wins, b_wins) in tally.items():
        if a_wins + b_wins < 2:
            continue
        (lead, lead_wins), (trail, trail_wins) = sorted(((a, a_wins), (b, b_wins)), key=lambda x: -x[1])
        rows.append({"a": {"user_id": lead, "display_name": names[lead]}, "b": {"user_id": trail, "display_name": names[trail]}, "a_wins": lead_wins, "b_wins": trail_wins, "meetings": a_wins + b_wins, "last_played_at": last[(a, b)]})
    return rows


@router.get("/v1/clubs/{club_id}/rivalries")
async def rivalries(club_id: UUID, kind: Literal["singles", "doubles"] = "singles", limit: int = Query(5, ge=1, le=20), session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Most-played, closest and one-sided player pairs (2+ rated meetings); private players are left out."""
    viewer = await require_member(session, club_id, actor.user_id)
    hidden = await hidden_for(session, club_id, actor.user_id, is_staff(viewer))
    names = await names_for(session, club_id)
    matches = (await session.scalars(select(RatedMatch).where(RatedMatch.club_id == club_id, RatedMatch.status == "finalized", RatedMatch.rated.is_(True), RatedMatch.kind == kind))).all()
    pairs = rivalry_rows(*rivalry_tally(matches, names, hidden), names)
    recent = lambda p: -p["last_played_at"].timestamp()  # noqa: E731
    return {
        "kind": kind,
        "most_played": sorted(pairs, key=lambda p: (-p["meetings"], recent(p)))[:limit],
        "closest": sorted([p for p in pairs if p["b_wins"] > 0 and p["a_wins"] - p["b_wins"] <= CLOSE_MARGIN], key=lambda p: (p["a_wins"] - p["b_wins"], -p["meetings"], recent(p)))[:limit],
        "one_sided": sorted([p for p in pairs if p["b_wins"] == 0], key=lambda p: (-p["meetings"], recent(p)))[:limit],
    }
''')

replace_block("app/challenges.py", "async def h2h(", '''
async def visible_pair(session: AsyncSession, club_id: UUID, players: tuple[str, str], can_see) -> tuple[dict[str, str], dict]:
    if players[0] == players[1]:
        raise HTTPException(status_code=422, detail="Choose two different players")
    names = await names_for(session, club_id)
    profiles = {p.user_id: p for p in (await session.scalars(select(PlayerProfile).where(PlayerProfile.club_id == club_id, PlayerProfile.user_id.in_(players)))).all()}
    if any(u not in names or not can_see(profiles.get(u)) for u in players):
        raise HTTPException(status_code=404, detail="Player not available")
    return names, profiles


async def meetings_between(session: AsyncSession, club_id: UUID, a: str, b: str) -> tuple[list[RatedMatch], dict]:
    """Finalized matches with a and b on opposite sides, plus their rating-history rows."""
    rows = (await session.scalars(select(RatedMatch).where(RatedMatch.club_id == club_id, RatedMatch.status == "finalized").order_by(RatedMatch.played_at.desc()).limit(5000))).all()
    meetings = [m for m in rows if (a in m.side_one and b in m.side_two) or (a in m.side_two and b in m.side_one)]
    if not meetings:
        return [], {}
    history = (await session.scalars(select(RatingHistory).where(RatingHistory.club_id == club_id, RatingHistory.rated_match_id.in_([m.id for m in meetings]), RatingHistory.user_id.in_([a, b])))).all()
    return meetings, {(h.rated_match_id, h.user_id): h for h in history}


def rating_change(history: dict, m: RatedMatch, user_id: str) -> dict | None:
    h = history.get((m.id, user_id))
    return {"before": round(float(h.rating_before), 2), "after": round(float(h.rating_after), 2), "delta": round(float(h.rating_after) - float(h.rating_before), 3)} if h else None


def meeting_view(m: RatedMatch, a: str, b: str, history: dict, person) -> dict:
    """One meeting from player A's point of view."""
    a_side = 1 if a in m.side_one else 2
    a_team, b_team = (m.side_one, m.side_two) if a_side == 1 else (m.side_two, m.side_one)
    return {
        "id": str(m.id), "kind": m.kind, "played_at": m.played_at, "score_text": m.score_text if a_side == 1 else flip_score(m.score_text),
        "outcome": m.outcome, "rated": m.rated, "a_won": m.winner_side == a_side if m.winner_side in (1, 2) else None,
        "a_partners": [person(u) for u in a_team if u != a], "b_partners": [person(u) for u in b_team if u != b],
        "a_change": rating_change(history, m, a), "b_change": rating_change(history, m, b),
    }


def h2h_summary(matches: list[dict]) -> dict:
    summary = {k: {"a_wins": 0, "b_wins": 0} for k in ("singles", "doubles")}
    for m in matches:
        if m["rated"] and m["a_won"] is not None:
            summary[m["kind"]]["a_wins" if m["a_won"] else "b_wins"] += 1
    return summary


async def h2h_player(session: AsyncSession, club_id: UUID, user_id: str, profile: PlayerProfile | None, name: str) -> dict:
    ratings = {}
    for kind in ("singles", "doubles"):
        ordered = await club_ratings(session, club_id, kind)
        row = next((r for r in ordered if r.user_id == user_id), None)
        ratings[kind] = rating_view(row, ordered.index(row) + 1 if row and row.verified_matches else None)
    return {"user_id": user_id, "display_name": profile.display_name if profile else name, "image_url": profile.image_url if profile else None, "city": profile.city if profile else None, "ratings": ratings}


async def h2h(session: AsyncSession, club_id: UUID, player_a: str, player_b: str, can_see, hidden: set[str]) -> dict:
    names, profiles = await visible_pair(session, club_id, (player_a, player_b), can_see)
    meetings, history = await meetings_between(session, club_id, player_a, player_b)

    def person(u: str) -> dict:
        return {"user_id": "private", "display_name": "Private player"} if u in hidden else {"user_id": u, "display_name": names.get(u, u)}

    matches = [meeting_view(m, player_a, player_b, history, person) for m in meetings]
    return {
        "a": await h2h_player(session, club_id, player_a, profiles.get(player_a), names[player_a]),
        "b": await h2h_player(session, club_id, player_b, profiles.get(player_b), names[player_b]),
        "summary": h2h_summary(matches), "matches": matches,
    }
''')

# Import cycle: the pending-replay registry lives in its own module with no app imports.
open("app/recalc_queue.py", "w").write('''"""Registry of in-flight background rating replays. Imports nothing from the app, so any module may use it."""
import asyncio
from collections.abc import Awaitable, Callable
from uuid import UUID

_dirty: set[UUID] = set()
_workers: dict[UUID, asyncio.Task] = {}


def start(club_id: UUID, replay: Callable[[UUID], Awaitable[None]]) -> None:
    """Mark the club for a replay; one worker per club drains repeated requests."""
    _dirty.add(club_id)
    if club_id not in _workers:
        _workers[club_id] = asyncio.get_running_loop().create_task(_run(club_id, replay))


async def _run(club_id: UUID, replay: Callable[[UUID], Awaitable[None]]) -> None:
    try:
        while club_id in _dirty:
            _dirty.discard(club_id)
            await replay(club_id)
    finally:
        _workers.pop(club_id, None)


async def ratings_settled(club_id: UUID | None = None) -> None:
    """Wait for any pending replay (one club, or all) so reads never show half-updated ratings."""
    current = asyncio.current_task()
    tasks = [t for c, t in list(_workers.items()) if (club_id is None or c == club_id) and t is not current]
    if tasks:
        await asyncio.wait(tasks)
''')
edit("app/rating_service.py", [
    ('''_dirty: set[UUID] = set()
_workers: dict[UUID, asyncio.Task] = {}
logger''', '''logger'''),
    ('''        for club_id in clubs:
            loop.call_soon(_start_worker, club_id)''', '''        for club_id in clubs:
            loop.call_soon(recalc_queue.start, club_id, _replay)'''),
    ('''def _start_worker(club_id: UUID) -> None:
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
''', '''async def _replay(club_id: UUID) -> None:
    """Background replay in its own session; a failure is logged and the next request retries."""
    try:
        async with SessionLocal() as session:
            await recalculate_club(session, club_id)
            await session.commit()
    except Exception:
        logger.exception("background rating recalculation failed for %s", club_id)
'''),
    ("from .common import notify\n", "from . import recalc_queue\nfrom .common import notify\nfrom .database import SessionLocal\nfrom .recalc_queue import ratings_settled  # noqa: F401  (re-exported for routers)\n"),
])
edit("app/common.py", [
    ('''    from .rating_service import ratings_settled  # late import: rating_service imports this module

    await ratings_settled(club_id)''', '''    await ratings_settled(club_id)'''),
    ("from .models import AuditLog, Membership, MembershipRole, Notification\n", "from .models import AuditLog, Membership, MembershipRole, Notification\nfrom .recalc_queue import ratings_settled\n"),
])
edit("app/models.py", [
    ('''    def process_bind_param(self, value, dialect):''', '''    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:'''),
    ('''    def process_result_value(self, value, dialect):''', '''    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:'''),
    ("from sqlalchemy.dialects import postgresql\n", "from sqlalchemy.dialects import postgresql\nfrom sqlalchemy.engine import Dialect\n"),
])
edit("app/ratings.py", [("from .pprc_rating import FORMULA_VERSION, MAX_RATING, MIN_RATING, OUTCOMES, FORMAT_WEIGHTS, PROVISIONAL_MATCHES", "from .pprc_rating import FORMULA_VERSION, MAX_RATING, MIN_RATING, OUTCOMES, FORMAT_WEIGHTS")])
print("ok")
