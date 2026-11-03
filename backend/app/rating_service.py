"""PPRC Rating persistence: deterministic club-wide replay and competition result sync."""
import asyncio
from collections import defaultdict
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import PlayerProfile, PlayerRating, RatedMatch, RatingHistory
from .pprc_rating import DEFAULT_START, FORMULA_VERSION, RatedInput, clamp, is_rateable, parse_score, replay

_locks: dict[UUID, asyncio.Lock] = defaultdict(asyncio.Lock)


def score_fields(score_text: str | None, outcome: str, winner_side: int | None) -> dict:
    """Derive games from the set score; a missing score downgrades a 'completed' match to no_score."""
    parsed = parse_score(score_text)
    games_one, games_two = (parsed[0], parsed[1]) if parsed else (None, None)
    if outcome == "completed" and parsed is None:
        outcome = "no_score"
    if parsed and winner_side is None and outcome == "completed" and parsed[2] != parsed[3]:
        winner_side = 1 if parsed[2] > parsed[3] else 2
    return {"games_one": games_one, "games_two": games_two, "outcome": outcome, "winner_side": winner_side}


async def recalculate_club(session: AsyncSession, club_id: UUID) -> int:
    """Rebuild every rating and history row for a club from finalized results. Idempotent; safe to rerun."""
    async with _locks[club_id]:
        profiles = list((await session.scalars(select(PlayerProfile).where(PlayerProfile.club_id == club_id))).all())
        start = {}
        for profile in profiles:
            start[(profile.user_id, "singles")] = float(profile.starting_singles)
            start[(profile.user_id, "doubles")] = float(profile.starting_doubles)
        matches = list((await session.scalars(select(RatedMatch).where(RatedMatch.club_id == club_id, RatedMatch.status == "finalized"))).all())
        inputs = []
        for match in matches:
            match.rated = bool(match.side_one and match.side_two and match.winner_side in (1, 2) and is_rateable(match.outcome, match.games_one, match.games_two))
            if match.rated:
                inputs.append(RatedInput(str(match.id), match.kind, tuple(match.side_one), tuple(match.side_two), match.winner_side, match.games_one, match.games_two, match.match_format, match.played_at))
        result = replay(start, inputs, as_of=datetime.now(timezone.utc))
        await session.execute(delete(RatingHistory).where(RatingHistory.club_id == club_id))
        await session.execute(delete(PlayerRating).where(PlayerRating.club_id == club_id))
        await session.flush()
        for key, rating in start.items():
            result.states.setdefault(key, None)
        for (user_id, kind), state in result.states.items():
            session.add(PlayerRating(
                club_id=club_id, user_id=user_id, kind=kind, formula_version=FORMULA_VERSION,
                rating=state.rating if state else clamp(start.get((user_id, kind), DEFAULT_START)),
                reliability=state.reliability if state else 0, verified_matches=state.verified if state else 0,
                wins=state.wins if state else 0, losses=state.losses if state else 0,
                provisional=state.provisional if state else True, last_played_at=state.last_played_at if state else None,
            ))
        for change in result.changes:
            session.add(RatingHistory(club_id=club_id, user_id=change.user_id, kind=change.kind, rated_match_id=UUID(change.match_id), rating_before=change.before, rating_after=change.after, played_at=change.played_at, formula_version=FORMULA_VERSION))
        await session.flush()
        return len(inputs)


async def sync_triace_fixture(session: AsyncSession, fixture) -> None:
    """Mirror each TRIACE rubber as a singles/doubles result. Rated only once the fixture is finalized."""
    if fixture.status.value == "finalized":
        status = "finalized"
    else:
        status = "disputed" if (fixture.result_detail or {}).get("dispute") else "reported"
    prefix = f"triace:{fixture.id}:"
    existing = {m.source_id: m for m in (await session.scalars(select(RatedMatch).where(RatedMatch.source_id.like(f"{prefix}%")))).all()}
    now = datetime.now(timezone.utc)
    played_at = fixture.starts_at if fixture.starts_at <= now else now
    seen = set()
    for index, rubber in enumerate((fixture.result_detail or {}).get("rubbers") or []):
        home, away = list(rubber["home_player_ids"]), list(rubber["away_player_ids"])
        home_score, away_score = int(rubber["home_score"]), int(rubber["away_score"])
        if len(home) != len(away) or home_score == away_score:
            continue
        tiebreak = rubber["kind"] == "super_tiebreak"
        source_id = f"{prefix}{index}"
        seen.add(source_id)
        record = existing.get(source_id)
        if record is None:
            record = RatedMatch(club_id=fixture.club_id, source="triace", source_id=source_id, division_id=fixture.division_id)
            session.add(record)
        record.kind = "doubles" if len(home) == 2 else "singles"
        record.side_one, record.side_two = home, away
        record.score_text = f"{home_score}-{away_score}"
        winner_one = home_score > away_score
        record.games_one, record.games_two = ((1, 0) if winner_one else (0, 1)) if tiebreak else (home_score, away_score)
        record.winner_side, record.outcome = 1 if winner_one else 2, "completed"
        record.match_format = "tiebreak" if tiebreak else "pro_set"
        record.played_at, record.status = played_at, status
    for source_id, record in existing.items():
        if source_id not in seen:
            record.status = "cancelled"
    await session.flush()
    await recalculate_club(session, fixture.club_id)


async def sync_competition_result(session: AsyncSession, club_id: UUID, division_id: UUID, match_id: UUID, side_one: list[str], side_two: list[str], *, winner_side: int, score_text: str | None, score_one: int | None, score_two: int | None, played_at: datetime | None, doubles: bool) -> None:
    """Mirror a finalized tournament/ladder match into PPRC Rating, then replay the club."""
    text = (score_text or "").strip()
    if text.upper().startswith("W/O"):
        outcome = "walkover"
    elif "ret" in text.lower():
        outcome = "retired"
    else:
        outcome = "completed"
    if not parse_score(text) and score_one is not None and score_two is not None and outcome == "completed":
        text = f"{score_one}-{score_two}"  # organizer entered games only
    fields = score_fields(text or None, outcome, winner_side)
    fields["winner_side"] = winner_side
    record = await session.scalar(select(RatedMatch).where(RatedMatch.source_id == str(match_id)))
    if record is None:
        record = RatedMatch(club_id=club_id, source="competition", source_id=str(match_id), division_id=division_id)
        session.add(record)
    record.kind = "doubles" if doubles else "singles"
    record.side_one, record.side_two = side_one, side_two
    record.score_text, record.status = text or None, "finalized"
    record.played_at = played_at or record.played_at or datetime.now(timezone.utc)
    for key, value in fields.items():
        setattr(record, key, value)
    await session.flush()
    await recalculate_club(session, club_id)
