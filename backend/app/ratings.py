"""Player profiles, PPRC Rating, rankings and player-reported results (club-scoped)."""
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import Actor, current_actor
from .common import STAFF_ROLES, audit, notify
from .database import get_session
from .models import Club, DivisionEntry, Membership, MembershipRole, PlayerProfile, PlayerRating, RatedMatch, RatingHistory
from .pprc_rating import FORMULA_VERSION, MAX_RATING, MIN_RATING, OUTCOMES, FORMAT_WEIGHTS
from .rating_service import recalculate_club, score_fields

router = APIRouter()
Kind = Literal["singles", "doubles"]
Visibility = Literal["public", "club", "private"]


class ProfileInput(BaseModel):
    display_name: str = Field(min_length=2, max_length=160)
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=60)
    home_club: str | None = Field(default=None, max_length=160)
    image_url: str | None = Field(default=None, max_length=500, pattern=r"^https?://")
    preferred_sport: str = Field(default="tennis", max_length=40)
    age_group: str | None = Field(default=None, max_length=40)
    gender_category: str | None = Field(default=None, max_length=40)
    visibility: Visibility = "club"
    starting_singles: float | None = Field(default=None, ge=MIN_RATING, le=MAX_RATING)
    starting_doubles: float | None = Field(default=None, ge=MIN_RATING, le=MAX_RATING)


class ResultInput(BaseModel):
    kind: Kind = "singles"
    partner_id: str | None = None
    opponent_ids: list[str] = Field(min_length=1, max_length=2)
    score_text: str | None = Field(default=None, max_length=120)
    outcome: str = "completed"
    match_format: str = "best_of_3"
    winner_side: Literal[1, 2] | None = None
    played_at: datetime | None = None


class ResultCorrection(BaseModel):
    score_text: str | None = Field(default=None, max_length=120)
    outcome: str | None = None
    winner_side: Literal[1, 2] | None = None
    reason: str = Field(min_length=5, max_length=500)


class ReasonInput(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


async def membership(session: AsyncSession, club_id: UUID, user_id: str) -> Membership | None:
    return await session.scalar(select(Membership).where(Membership.club_id == club_id, Membership.user_id == user_id))


async def require_member(session: AsyncSession, club_id: UUID, user_id: str) -> Membership:
    member = await membership(session, club_id, user_id)
    if member is None:
        raise HTTPException(status_code=403, detail="Club membership required")
    return member


def is_staff(member: Membership | None) -> bool:
    return member is not None and member.role in STAFF_ROLES


def visible(profile: PlayerProfile | None, viewer: str, staff: bool) -> bool:
    """Members see public and club profiles; private profiles are visible to the player and staff only."""
    return profile is None or profile.visibility != "private" or staff or profile.user_id == viewer


async def names_for(session: AsyncSession, club_id: UUID) -> dict[str, str]:
    names = {m.user_id: m.display_name for m in (await session.scalars(select(Membership).where(Membership.club_id == club_id))).all()}
    names.update({p.user_id: p.display_name for p in (await session.scalars(select(PlayerProfile).where(PlayerProfile.club_id == club_id))).all()})
    return names


def rating_view(row: PlayerRating | None, rank: int | None = None) -> dict | None:
    if row is None:
        return None
    return {
        "rating": round(float(row.rating), 2), "reliability": float(row.reliability), "provisional": row.provisional,
        "verified_matches": row.verified_matches, "wins": row.wins, "losses": row.losses, "rank": rank,
        "last_played_at": row.last_played_at, "formula_version": row.formula_version,
    }


def profile_view(profile: PlayerProfile | None, user_id: str, name: str, *, full: bool) -> dict:
    base = {"user_id": user_id, "display_name": profile.display_name if profile else name}
    if profile is None:
        return {**base, "visibility": "club", "has_profile": False}
    base.update({"city": profile.city, "state": profile.state, "home_club": profile.home_club, "image_url": profile.image_url, "preferred_sport": profile.preferred_sport, "has_profile": True})
    if full:
        base.update({"age_group": profile.age_group, "gender_category": profile.gender_category, "visibility": profile.visibility, "starting_singles": float(profile.starting_singles), "starting_doubles": float(profile.starting_doubles)})
    return base


def match_view(match: RatedMatch, names: dict[str, str], hidden: set[str] = frozenset()) -> dict:
    def person(u: str) -> dict:
        return {"user_id": "private", "display_name": "Private player"} if u in hidden else {"user_id": u, "display_name": names.get(u, u)}

    return {
        "id": str(match.id), "source": match.source, "kind": match.kind, "status": match.status, "outcome": match.outcome,
        "rated": match.rated, "score_text": match.score_text, "winner_side": match.winner_side, "match_format": match.match_format,
        "played_at": match.played_at, "reported_by": match.reported_by, "dispute_reason": match.dispute_reason, "correction_reason": match.correction_reason,
        "side_one": [person(u) for u in match.side_one],
        "side_two": [person(u) for u in match.side_two],
    }


async def hidden_for(session: AsyncSession, club_id: UUID, viewer: str, staff: bool) -> set[str]:
    """Private players are anonymised in match lists for everyone except themselves and staff."""
    if staff:
        return set()
    rows = (await session.scalars(select(PlayerProfile.user_id).where(PlayerProfile.club_id == club_id, PlayerProfile.visibility == "private"))).all()
    return set(rows) - {viewer}


async def club_ratings(session: AsyncSession, club_id: UUID, kind: str) -> list[PlayerRating]:
    rows = list((await session.scalars(select(PlayerRating).where(PlayerRating.club_id == club_id, PlayerRating.kind == kind))).all())
    return sorted(rows, key=lambda r: (-float(r.rating), -float(r.reliability), r.user_id))


async def player_detail(session: AsyncSession, club_id: UUID, user_id: str, *, full: bool, hidden: set[str] = frozenset()) -> dict:
    profile = await session.scalar(select(PlayerProfile).where(PlayerProfile.club_id == club_id, PlayerProfile.user_id == user_id))
    names = await names_for(session, club_id)
    if profile is None and user_id not in names:
        raise HTTPException(status_code=404, detail="Player not found")
    ratings = {}
    for kind in ("singles", "doubles"):
        ordered = await club_ratings(session, club_id, kind)
        row = next((r for r in ordered if r.user_id == user_id), None)
        ratings[kind] = rating_view(row, ordered.index(row) + 1 if row and row.verified_matches else None)
    history = list((await session.scalars(select(RatingHistory).where(RatingHistory.club_id == club_id, RatingHistory.user_id == user_id).order_by(RatingHistory.played_at))).all())
    matches = [m for m in (await session.scalars(select(RatedMatch).where(RatedMatch.club_id == club_id).order_by(RatedMatch.played_at.desc()))).all() if user_id in m.side_one or user_id in m.side_two]
    finalized = [m for m in matches if m.status == "finalized" and m.rated]
    form = ["W" if (m.winner_side == 1) == (user_id in m.side_one) else "L" for m in finalized[:5]]
    partners = sorted({u for m in finalized if m.kind == "doubles" for side in (m.side_one, m.side_two) if user_id in side for u in side if u != user_id and u not in hidden})
    return {
        "profile": profile_view(profile, user_id, names.get(user_id, user_id), full=full),
        "ratings": ratings, "recent_form": form,
        "record": {"wins": sum(1 for m in finalized if (m.winner_side == 1) == (user_id in m.side_one)), "losses": sum(1 for m in finalized if (m.winner_side == 1) != (user_id in m.side_one))},
        "history": [{"kind": h.kind, "played_at": h.played_at, "rating": round(float(h.rating_after), 2)} for h in history],
        "recent_matches": [match_view(m, names, hidden) for m in matches[:10]],
        "doubles_partners": [{"user_id": u, "display_name": names.get(u, u)} for u in partners],
    }


@router.get("/v1/rating/formula")
async def rating_formula() -> dict:
    return {"version": FORMULA_VERSION, "min": MIN_RATING, "max": MAX_RATING, "outcomes": sorted(OUTCOMES), "formats": FORMAT_WEIGHTS}


@router.get("/v1/clubs/{club_id}/players/me")
async def my_player(club_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    await require_member(session, club_id, actor.user_id)
    return await player_detail(session, club_id, actor.user_id, full=True, hidden=await hidden_for(session, club_id, actor.user_id, False))


@router.put("/v1/clubs/{club_id}/players/me")
async def save_my_player(club_id: UUID, payload: ProfileInput, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Onboarding and profile edits. Starting ratings can only be chosen before any verified match."""
    member = await require_member(session, club_id, actor.user_id)
    profile = await session.scalar(select(PlayerProfile).where(PlayerProfile.club_id == club_id, PlayerProfile.user_id == actor.user_id))
    rated = await session.scalar(select(PlayerRating.id).where(PlayerRating.club_id == club_id, PlayerRating.user_id == actor.user_id, PlayerRating.verified_matches > 0).limit(1))
    values = payload.model_dump(exclude={"starting_singles", "starting_doubles"})
    if profile is None:
        profile = PlayerProfile(club_id=club_id, user_id=actor.user_id, **values, starting_singles=payload.starting_singles or 5, starting_doubles=payload.starting_doubles or payload.starting_singles or 5)
        session.add(profile)
    else:
        for key, value in values.items():
            setattr(profile, key, value)
        for key in ("starting_singles", "starting_doubles"):
            value = getattr(payload, key)
            if value is not None and float(value) != float(getattr(profile, key)):
                if rated:
                    raise HTTPException(status_code=409, detail="Starting ratings are locked after your first verified match")
                setattr(profile, key, value)
    member.display_name = payload.display_name
    await session.flush()
    await recalculate_club(session, club_id)
    await audit(session, club_id, actor.user_id, "profile.saved", "player", actor.user_id)
    await session.commit()
    return await player_detail(session, club_id, actor.user_id, full=True)


@router.get("/v1/clubs/{club_id}/players")
async def list_players(
    club_id: UUID, q: str | None = None, city: str | None = None, home_club: str | None = None,
    min_rating: float | None = None, max_rating: float | None = None, division_id: UUID | None = None,
    age_group: str | None = None, kind: Kind = "singles", page: int = Query(1, ge=1), page_size: int = Query(24, ge=1, le=100),
    session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor),
) -> dict:
    viewer = await require_member(session, club_id, actor.user_id)
    staff = is_staff(viewer)
    profiles = {p.user_id: p for p in (await session.scalars(select(PlayerProfile).where(PlayerProfile.club_id == club_id))).all()}
    ratings = {r.user_id: r for r in await club_ratings(session, club_id, kind)}
    names = await names_for(session, club_id)
    members = [m for m in (await session.scalars(select(Membership).where(Membership.club_id == club_id))).all() if m.role in {MembershipRole.player, *STAFF_ROLES}]
    entered = None
    if division_id:
        entered = set((await session.scalars(select(DivisionEntry.user_id).where(DivisionEntry.division_id == division_id, DivisionEntry.club_id == club_id, DivisionEntry.status == "active"))).all())
    rows = []
    for user_id in sorted({m.user_id for m in members} | set(profiles)):
        profile, rating = profiles.get(user_id), ratings.get(user_id)
        if not visible(profile, actor.user_id, staff):
            continue
        name = names.get(user_id, user_id)
        value = float(rating.rating) if rating else None
        checks = [
            not q or q.lower() in name.lower(),
            not city or (profile and profile.city and city.lower() in profile.city.lower()),
            not home_club or (profile and profile.home_club and home_club.lower() in profile.home_club.lower()),
            min_rating is None or (value is not None and value >= min_rating),
            max_rating is None or (value is not None and value <= max_rating),
            not age_group or (profile and profile.age_group == age_group),
            entered is None or user_id in entered,
        ]
        if all(checks):
            rows.append({**profile_view(profile, user_id, name, full=False), "rating": rating_view(rating)})
    rows.sort(key=lambda r: (-(r["rating"]["rating"] if r["rating"] else 0), r["display_name"].lower()))
    start = (page - 1) * page_size
    return {"items": rows[start:start + page_size], "total": len(rows), "page": page, "page_size": page_size}


@router.get("/v1/clubs/{club_id}/players/{user_id}")
async def get_player(club_id: UUID, user_id: str, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    viewer = await require_member(session, club_id, actor.user_id)
    profile = await session.scalar(select(PlayerProfile).where(PlayerProfile.club_id == club_id, PlayerProfile.user_id == user_id))
    if not visible(profile, actor.user_id, is_staff(viewer)):
        raise HTTPException(status_code=404, detail="Player not found")
    staff = is_staff(viewer)
    return await player_detail(session, club_id, user_id, full=staff or user_id == actor.user_id, hidden=await hidden_for(session, club_id, actor.user_id, staff))


@router.get("/v1/public/clubs/{slug}/players/{user_id}")
async def get_public_player(slug: str, user_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    """Privacy-safe public profile: only for players who chose public visibility."""
    club = await session.scalar(select(Club).where(Club.slug == slug))
    profile = club and await session.scalar(select(PlayerProfile).where(PlayerProfile.club_id == club.id, PlayerProfile.user_id == user_id))
    if not profile or profile.visibility != "public":
        raise HTTPException(status_code=404, detail="Player not found")
    detail = await player_detail(session, club.id, user_id, full=False)
    detail.pop("recent_matches")
    detail.pop("doubles_partners")
    return detail


async def history_rank_movement(session: AsyncSession, club_id: UUID, kind: str, rows: list[PlayerRating], days: int = 30) -> dict[str, int]:
    """Places gained (+) or lost (-) against the same list as it stood `days` ago."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    history = list((await session.scalars(select(RatingHistory).where(RatingHistory.club_id == club_id, RatingHistory.kind == kind, RatingHistory.played_at > cutoff).order_by(RatingHistory.played_at))).all())
    then = {r.user_id: float(r.rating) for r in rows}
    seen: set[str] = set()
    for h in history:
        if h.user_id in then and h.user_id not in seen:
            then[h.user_id] = float(h.rating_before)
            seen.add(h.user_id)
    previous = {user: index + 1 for index, user in enumerate(sorted(then, key=lambda u: -then[u]))}
    return {r.user_id: previous[r.user_id] - (index + 1) for index, r in enumerate(rows)}


@router.get("/v1/clubs/{club_id}/rankings")
async def club_rankings(
    club_id: UUID, kind: Kind = "singles", city: str | None = None, state: str | None = None, age_group: str | None = None,
    gender_category: str | None = None, division_id: UUID | None = None, min_rating: float | None = None, max_rating: float | None = None,
    include_provisional: bool = True, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor),
) -> dict:
    """Club ranking: rated players of this club only, ordered by rating, then reliability."""
    viewer = await require_member(session, club_id, actor.user_id)
    staff = is_staff(viewer)
    profiles = {p.user_id: p for p in (await session.scalars(select(PlayerProfile).where(PlayerProfile.club_id == club_id))).all()}
    names = await names_for(session, club_id)
    entered = None
    if division_id:
        entered = set((await session.scalars(select(DivisionEntry.user_id).where(DivisionEntry.division_id == division_id, DivisionEntry.club_id == club_id))).all())
    rows = []
    for r in await club_ratings(session, club_id, kind):
        p = profiles.get(r.user_id)
        value = float(r.rating)
        if r.verified_matches == 0 or not visible(p, actor.user_id, staff):
            continue
        checks = [
            include_provisional or not r.provisional,
            not city or (p and p.city and city.lower() in p.city.lower()), not state or (p and p.state == state),
            not age_group or (p and p.age_group == age_group), not gender_category or (p and p.gender_category == gender_category),
            entered is None or r.user_id in entered, min_rating is None or value >= min_rating, max_rating is None or value <= max_rating,
        ]
        if all(checks):
            rows.append(r)
    movement = await history_rank_movement(session, club_id, kind, rows)
    start = (page - 1) * page_size
    items = [{
        "rank": start + i + 1, "movement": movement.get(r.user_id, 0),
        **profile_view(profiles.get(r.user_id), r.user_id, names.get(r.user_id, r.user_id), full=False),
        **rating_view(r, start + i + 1),
    } for i, r in enumerate(rows[start:start + page_size])]
    return {"items": items, "total": len(rows), "page": page, "page_size": page_size, "kind": kind, "scope": "club"}


@router.get("/v1/public/rankings")
async def platform_rankings(kind: Kind = "singles", page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100), session: AsyncSession = Depends(get_session)) -> dict:
    """Platform-wide ranking across clubs: public profiles and established ratings only."""
    profiles = {(p.club_id, p.user_id): p for p in (await session.scalars(select(PlayerProfile).where(PlayerProfile.visibility == "public"))).all()}
    clubs = {c.id: c for c in (await session.scalars(select(Club))).all()}
    rows = [r for r in (await session.scalars(select(PlayerRating).where(PlayerRating.kind == kind, PlayerRating.verified_matches > 0))).all() if (r.club_id, r.user_id) in profiles]
    rows.sort(key=lambda r: (-float(r.rating), -float(r.reliability), r.user_id))
    start = (page - 1) * page_size
    items = []
    for i, r in enumerate(rows[start:start + page_size]):
        p = profiles[(r.club_id, r.user_id)]
        items.append({"rank": start + i + 1, "user_id": r.user_id, "display_name": p.display_name, "city": p.city, "state": p.state, "club_name": clubs[r.club_id].name, "club_slug": clubs[r.club_id].slug, "image_url": p.image_url, **rating_view(r, start + i + 1)})
    return {"items": items, "total": len(rows), "page": page, "page_size": page_size, "kind": kind, "scope": "platform"}


@router.post("/v1/clubs/{club_id}/ratings/recalculate")
async def recalculate(club_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    if not is_staff(await membership(session, club_id, actor.user_id)):
        raise HTTPException(status_code=403, detail="Club role is not permitted")
    rated = await recalculate_club(session, club_id)
    await audit(session, club_id, actor.user_id, "ratings.recalculated", "club", str(club_id), FORMULA_VERSION)
    await session.commit()
    return {"rated_matches": rated, "formula_version": FORMULA_VERSION}


def validate_result_fields(outcome: str, match_format: str) -> None:
    if outcome not in OUTCOMES:
        raise HTTPException(status_code=422, detail=f"Outcome must be one of: {', '.join(sorted(OUTCOMES))}")
    if match_format not in FORMAT_WEIGHTS:
        raise HTTPException(status_code=422, detail=f"Format must be one of: {', '.join(FORMAT_WEIGHTS)}")


@router.post("/v1/clubs/{club_id}/match-results", status_code=status.HTTP_201_CREATED)
async def report_result(club_id: UUID, payload: ResultInput, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """A participant reports a result (their side is side one). It is rated only after the opponent confirms or staff finalize."""
    await require_member(session, club_id, actor.user_id)
    validate_result_fields(payload.outcome, payload.match_format)
    side_one = [actor.user_id, *([payload.partner_id] if payload.partner_id else [])]
    side_two = list(dict.fromkeys(payload.opponent_ids))
    size = 2 if payload.kind == "doubles" else 1
    if len(set(side_one)) != size or len(set(side_two)) != size or set(side_one) & set(side_two):
        raise HTTPException(status_code=422, detail=f"{payload.kind.title()} needs {size} different player(s) per side")
    for person in side_one[1:] + side_two:
        if await membership(session, club_id, person) is None:
            raise HTTPException(status_code=422, detail="Every player must be a member of this club")
    fields = score_fields(payload.score_text, payload.outcome, payload.winner_side)
    if fields["winner_side"] is None and fields["outcome"] != "incomplete" and fields["outcome"] != "no_score":
        raise HTTPException(status_code=422, detail="Choose the winning side or enter a set score")
    played_at = payload.played_at or datetime.now(timezone.utc)
    if played_at.tzinfo is None:
        played_at = played_at.replace(tzinfo=timezone.utc)
    if played_at > datetime.now(timezone.utc) + timedelta(hours=1):
        raise HTTPException(status_code=422, detail="Results cannot be dated in the future")
    record = RatedMatch(club_id=club_id, source="reported", kind=payload.kind, side_one=side_one, side_two=side_two, score_text=payload.score_text, match_format=payload.match_format, played_at=played_at, status="reported", reported_by=actor.user_id, **fields)
    session.add(record)
    await session.flush()
    for person in side_two:
        await notify(session, club_id, person, "result", "Confirm a match result", "A match result involving you is waiting for your confirmation.", {"resultId": str(record.id)})
    await audit(session, club_id, actor.user_id, "result.reported", "rated_match", str(record.id))
    await session.commit()
    return match_view(record, await names_for(session, club_id))


@router.get("/v1/clubs/{club_id}/match-results")
async def list_results(club_id: UUID, mine: bool = True, status_filter: str | None = Query(None, alias="status"), session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[dict]:
    viewer = await require_member(session, club_id, actor.user_id)
    rows = list((await session.scalars(select(RatedMatch).where(RatedMatch.club_id == club_id).order_by(RatedMatch.played_at.desc()).limit(500))).all())
    if mine or not is_staff(viewer):
        rows = [m for m in rows if actor.user_id in m.side_one or actor.user_id in m.side_two]
    if status_filter:
        rows = [m for m in rows if m.status == status_filter]
    names = await names_for(session, club_id)
    hidden = await hidden_for(session, club_id, actor.user_id, is_staff(viewer))
    return [match_view(m, names, hidden) for m in rows]


async def load_reported(session: AsyncSession, result_id: UUID) -> RatedMatch:
    record = await session.get(RatedMatch, result_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Result not found")
    if record.source != "reported":
        raise HTTPException(status_code=409, detail="Tournament results are managed on the event's match board")
    return record


def opposing(record: RatedMatch, user_id: str) -> bool:
    reporter_one = record.reported_by in record.side_one
    return user_id in (record.side_two if reporter_one else record.side_one)


@router.post("/v1/match-results/{result_id}/confirm")
async def confirm_result(result_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    record = await load_reported(session, result_id)
    if record.status != "reported":
        raise HTTPException(status_code=409, detail="Only a reported result can be confirmed")
    if not opposing(record, actor.user_id):
        raise HTTPException(status_code=403, detail="The opposing side must confirm this result")
    record.status, record.confirmed_by = "finalized", actor.user_id
    await session.flush()
    await recalculate_club(session, record.club_id)
    await audit(session, record.club_id, actor.user_id, "result.confirmed", "rated_match", str(record.id))
    await session.commit()
    return match_view(record, await names_for(session, record.club_id))


@router.post("/v1/match-results/{result_id}/dispute")
async def dispute_result(result_id: UUID, payload: ReasonInput, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    record = await load_reported(session, result_id)
    if record.status != "reported":
        raise HTTPException(status_code=409, detail="Only a reported result can be disputed")
    if not opposing(record, actor.user_id):
        raise HTTPException(status_code=403, detail="The opposing side must raise a dispute")
    record.status, record.dispute_reason = "disputed", payload.reason
    await audit(session, record.club_id, actor.user_id, "result.disputed", "rated_match", str(record.id), payload.reason)
    await session.commit()
    return match_view(record, await names_for(session, record.club_id))


@router.post("/v1/match-results/{result_id}/finalize")
async def finalize_result(result_id: UUID, payload: ResultCorrection, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Organizer verification, dispute resolution or correction; ratings are replayed afterwards."""
    record = await load_reported(session, result_id)
    if not is_staff(await membership(session, record.club_id, actor.user_id)):
        raise HTTPException(status_code=403, detail="Club role is not permitted")
    outcome = payload.outcome or record.outcome
    validate_result_fields(outcome, record.match_format)
    score_text = payload.score_text if payload.score_text is not None else record.score_text
    fields = score_fields(score_text, outcome, payload.winner_side or (record.winner_side if payload.score_text is None else None))
    if fields["winner_side"] is None and fields["outcome"] not in {"incomplete", "no_score"}:
        raise HTTPException(status_code=422, detail="Choose the winning side or enter a set score")
    action = "result.corrected" if record.status == "finalized" else "result.verified"
    record.score_text, record.status, record.correction_reason = score_text, "finalized", payload.reason
    for key, value in fields.items():
        setattr(record, key, value)
    await session.flush()
    await recalculate_club(session, record.club_id)
    await audit(session, record.club_id, actor.user_id, action, "rated_match", str(record.id), payload.reason)
    await session.commit()
    return match_view(record, await names_for(session, record.club_id))


@router.post("/v1/match-results/{result_id}/void")
async def void_result(result_id: UUID, payload: ReasonInput, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Score reversal: the result stops counting and every affected rating is recomputed."""
    record = await load_reported(session, result_id)
    member = await membership(session, record.club_id, actor.user_id)
    if not is_staff(member) and not (record.status == "reported" and record.reported_by == actor.user_id):
        raise HTTPException(status_code=403, detail="Only organizers can void a verified result")
    record.status, record.correction_reason = "cancelled", payload.reason
    await session.flush()
    await recalculate_club(session, record.club_id)
    await audit(session, record.club_id, actor.user_id, "result.voided", "rated_match", str(record.id), payload.reason)
    await session.commit()
    return match_view(record, await names_for(session, record.club_id))
