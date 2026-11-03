"""Match challenges (from the fair match finder) and head-to-head rivalry pages."""
import logging
import os
import re
from datetime import datetime, timezone
from html import escape
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import Actor, current_actor
from .common import audit, notify
from .database import get_session
from .emailer import send_email
from .models import Challenge, PlayerPreference, PlayerProfile, RatedMatch, RatingHistory
from .ratings import ResultInput, club_ratings, hidden_for, is_staff, membership, names_for, rating_view, report_result, require_member, visible

logger = logging.getLogger("uvicorn.error")
router = APIRouter()
OPEN = ("pending", "accepted")
MAX_OPEN_SENT = 10
SET = re.compile(r"(\d+)-(\d+)(\(\d+\))?")


def flip_score(text: str | None) -> str | None:
    """Scores are stored side-one first; flip each set to show the other side first."""
    return SET.sub(lambda m: f"{m.group(2)}-{m.group(1)}{m.group(3) or ''}", text) if text else text


class ChallengeInput(BaseModel):
    opponent_id: str = Field(min_length=1, max_length=128)
    kind: Literal["singles"] = "singles"
    proposed_at: datetime | None = None
    message: str | None = Field(default=None, max_length=280)


class RespondInput(BaseModel):
    action: Literal["accept", "decline"]


class ChallengeResult(BaseModel):
    score_text: str | None = Field(default=None, max_length=120)
    outcome: str = "completed"
    match_format: str = "best_of_3"
    i_won: bool | None = None
    played_at: datetime | None = None


def challenge_view(c: Challenge, me: str, names: dict[str, str], result_status: str | None) -> dict:
    other = c.opponent_id if c.challenger_id == me else c.challenger_id
    return {
        "id": str(c.id), "kind": c.kind, "status": c.status, "direction": "sent" if c.challenger_id == me else "received",
        "opponent": {"user_id": other, "display_name": names.get(other, other)},
        "proposed_at": c.proposed_at, "message": c.message, "created_at": c.created_at, "responded_at": c.responded_at,
        "result_id": str(c.result_id) if c.result_id else None, "result_status": result_status,
    }


def challenge_email(challenger: str, rating: float | None, when: datetime | None, link: str) -> str:
    """Fixed template; the free-text note is never emailed (it stays in-app)."""
    rating_line = f" (PPRC singles {rating:.2f})" if rating is not None else ""
    when_line = f'<p style="margin:0 0 12px;color:#26394a">Suggested time: {escape(when.strftime("%a %b %d, %I:%M %p UTC"))}</p>' if when else ""
    return (f'<table role="presentation" width="100%" style="background:#f4f7f9"><tr><td align="center" style="padding:16px 8px">'
            f'<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px"><tr><td style="padding:28px;font-family:Arial,sans-serif;color:#26394a">'
            f'<p style="margin:0;font-size:12px;letter-spacing:2px;color:#087f80">PPRC MATCH CHALLENGE</p>'
            f'<h1 style="margin:8px 0 12px;font-size:24px;color:#102c43">{escape(challenger)}{escape(rating_line)} challenged you to a singles match</h1>'
            f'{when_line}<p style="margin:0 0 20px;color:#26394a">You were matched as a fair opponent. Accept or decline in the PPRC app; once accepted, either of you can report the score.</p>'
            f'<p style="margin:0 0 24px"><a href="{escape(link)}" style="background:#102c43;color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700">Open the challenge</a></p>'
            f'<p style="font-size:12px;color:#8a99a6">Sent by PPRC Tennis because a club member challenged you. We never ask for your password or payment details by email.</p>'
            f'</td></tr></table></td></tr></table>')


async def email_opponent(session: AsyncSession, c: Challenge, challenger_name: str) -> bool:
    prefs = await session.scalar(select(PlayerPreference).where(PlayerPreference.club_id == c.club_id, PlayerPreference.user_id == c.opponent_id))
    if prefs is None or not prefs.email:
        return False
    mine = next((r for r in await club_ratings(session, c.club_id, "singles") if r.user_id == c.challenger_id), None)
    link = f"{os.environ['PPRC_APP_ORIGIN'].rstrip('/')}/me/matches?challenge={c.id}"
    try:
        await send_email(to=prefs.email, subject=f"{challenger_name} challenged you on PPRC", html=challenge_email(challenger_name, float(mine.rating) if mine else None, c.proposed_at, link))
        return True
    except Exception:
        logger.exception("challenge email failed for %s", c.id)  # the in-app alert still reaches them
        return False


async def load_challenge(session: AsyncSession, challenge_id: UUID, actor: Actor) -> Challenge:
    c = await session.get(Challenge, challenge_id)
    if c is None or actor.user_id not in (c.challenger_id, c.opponent_id):
        raise HTTPException(status_code=404, detail="Challenge not found")
    return c


async def respond_view(session: AsyncSession, c: Challenge, me: str) -> dict:
    result = await session.get(RatedMatch, c.result_id) if c.result_id else None
    return challenge_view(c, me, await names_for(session, c.club_id), result.status if result else None)


@router.post("/v1/clubs/{club_id}/challenges", status_code=201)
async def create_challenge(club_id: UUID, payload: ChallengeInput, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    await require_member(session, club_id, actor.user_id)
    if payload.opponent_id == actor.user_id:
        raise HTTPException(status_code=422, detail="You cannot challenge yourself")
    if await membership(session, club_id, payload.opponent_id) is None:
        raise HTTPException(status_code=404, detail="Player not found")
    profile = await session.scalar(select(PlayerProfile).where(PlayerProfile.club_id == club_id, PlayerProfile.user_id == payload.opponent_id))
    if not visible(profile, actor.user_id, False):
        raise HTTPException(status_code=404, detail="Player not found")
    pair = or_((Challenge.challenger_id == actor.user_id) & (Challenge.opponent_id == payload.opponent_id), (Challenge.challenger_id == payload.opponent_id) & (Challenge.opponent_id == actor.user_id))
    if await session.scalar(select(Challenge.id).where(Challenge.club_id == club_id, pair, Challenge.status.in_(OPEN)).limit(1)):
        raise HTTPException(status_code=409, detail="You already have an open challenge with this player")
    open_sent = (await session.scalars(select(Challenge.id).where(Challenge.club_id == club_id, Challenge.challenger_id == actor.user_id, Challenge.status == "pending"))).all()
    if len(open_sent) >= MAX_OPEN_SENT:
        raise HTTPException(status_code=429, detail="Wait for replies before sending more challenges")
    proposed = payload.proposed_at
    if proposed and proposed.tzinfo is None:
        proposed = proposed.replace(tzinfo=timezone.utc)
    c = Challenge(club_id=club_id, challenger_id=actor.user_id, opponent_id=payload.opponent_id, kind=payload.kind, proposed_at=proposed, message=(payload.message or "").strip() or None, status="pending")
    session.add(c)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail="You already have an open challenge with this player")
    names = await names_for(session, club_id)
    me = names.get(actor.user_id, "A club member")
    await notify(session, club_id, payload.opponent_id, "challenge", f"{me} challenged you", "Accept or decline the singles match challenge.", {"challengeId": str(c.id), "link": f"/me/matches?challenge={c.id}"})
    await audit(session, club_id, actor.user_id, "challenge.sent", "challenge", str(c.id))
    await session.commit()
    emailed = await email_opponent(session, c, me)
    return {**challenge_view(c, actor.user_id, names, None), "emailed": emailed}


@router.get("/v1/clubs/{club_id}/challenges")
async def list_challenges(club_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[dict]:
    await require_member(session, club_id, actor.user_id)
    rows = (await session.scalars(select(Challenge).where(Challenge.club_id == club_id, or_(Challenge.challenger_id == actor.user_id, Challenge.opponent_id == actor.user_id)).order_by(Challenge.created_at.desc()).limit(100))).all()
    results = {m.id: m.status for m in (await session.scalars(select(RatedMatch).where(RatedMatch.id.in_([c.result_id for c in rows if c.result_id])))).all()} if any(c.result_id for c in rows) else {}
    names = await names_for(session, club_id)
    return [challenge_view(c, actor.user_id, names, results.get(c.result_id)) for c in rows]


@router.post("/v1/challenges/{challenge_id}/respond")
async def respond_challenge(challenge_id: UUID, payload: RespondInput, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    c = await load_challenge(session, challenge_id, actor)
    if c.opponent_id != actor.user_id:
        raise HTTPException(status_code=403, detail="Only the challenged player can respond")
    if c.status != "pending":
        raise HTTPException(status_code=409, detail="This challenge has already been answered")
    c.status, c.responded_at = ("accepted" if payload.action == "accept" else "declined"), datetime.now(timezone.utc)
    me = (await names_for(session, c.club_id)).get(actor.user_id, "Your opponent")
    body = "Play the match, then either of you reports the score." if c.status == "accepted" else "Find another fair match in My matches."
    await notify(session, c.club_id, c.challenger_id, "challenge", f"{me} {c.status} your challenge", body, {"challengeId": str(c.id), "link": f"/me/matches?challenge={c.id}"})
    await audit(session, c.club_id, actor.user_id, f"challenge.{c.status}", "challenge", str(c.id))
    await session.commit()
    return await respond_view(session, c, actor.user_id)


@router.post("/v1/challenges/{challenge_id}/cancel")
async def cancel_challenge(challenge_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    c = await load_challenge(session, challenge_id, actor)
    if c.status not in OPEN:
        raise HTTPException(status_code=409, detail="Only an open challenge can be cancelled")
    if c.status == "pending" and c.challenger_id != actor.user_id:
        raise HTTPException(status_code=403, detail="Decline the challenge instead")
    c.status = "cancelled"
    other = c.opponent_id if c.challenger_id == actor.user_id else c.challenger_id
    await notify(session, c.club_id, other, "challenge", "A challenge was cancelled", "The match challenge between you was called off.", {"challengeId": str(c.id), "link": "/me/matches"})
    await audit(session, c.club_id, actor.user_id, "challenge.cancelled", "challenge", str(c.id))
    await session.commit()
    return await respond_view(session, c, actor.user_id)


@router.post("/v1/challenges/{challenge_id}/result")
async def report_challenge_result(challenge_id: UUID, payload: ChallengeResult, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Report the score of an accepted challenge; it goes through the normal confirm-then-rate flow."""
    c = await load_challenge(session, challenge_id, actor)
    previous = await session.get(RatedMatch, c.result_id) if c.result_id else None
    if not (c.status == "accepted" or (c.status == "completed" and previous is not None and previous.status == "cancelled")):
        raise HTTPException(status_code=409, detail="Only an accepted challenge (or one whose result was voided) can be reported")
    other = c.opponent_id if c.challenger_id == actor.user_id else c.challenger_id
    winner = None if payload.i_won is None else (1 if payload.i_won else 2)
    result = await report_result(c.club_id, ResultInput(kind=c.kind, opponent_ids=[other], score_text=payload.score_text, outcome=payload.outcome, match_format=payload.match_format, winner_side=winner, played_at=payload.played_at), session, actor)
    c.status, c.result_id = "completed", UUID(result["id"])
    await audit(session, c.club_id, actor.user_id, "challenge.reported", "challenge", str(c.id))
    await session.commit()
    return await respond_view(session, c, actor.user_id)


@router.get("/v1/clubs/{club_id}/head-to-head/{player_a}/{player_b}")
async def head_to_head(club_id: UUID, player_a: str, player_b: str, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Every finalized meeting between two players, with each player's rating change in that match."""
    viewer = await require_member(session, club_id, actor.user_id)
    staff = is_staff(viewer)
    if player_a == player_b:
        raise HTTPException(status_code=422, detail="Choose two different players")
    names = await names_for(session, club_id)
    profiles = {p.user_id: p for p in (await session.scalars(select(PlayerProfile).where(PlayerProfile.club_id == club_id, PlayerProfile.user_id.in_([player_a, player_b])))).all()}
    for u in (player_a, player_b):
        if u not in names or not visible(profiles.get(u), actor.user_id, staff):
            raise HTTPException(status_code=404, detail="Player not available")
    hidden = await hidden_for(session, club_id, actor.user_id, staff)
    rows = (await session.scalars(select(RatedMatch).where(RatedMatch.club_id == club_id, RatedMatch.status == "finalized").order_by(RatedMatch.played_at.desc()).limit(5000))).all()
    meetings = [m for m in rows if (player_a in m.side_one and player_b in m.side_two) or (player_a in m.side_two and player_b in m.side_one)]
    history = {(h.rated_match_id, h.user_id): h for h in (await session.scalars(select(RatingHistory).where(RatingHistory.club_id == club_id, RatingHistory.rated_match_id.in_([m.id for m in meetings]), RatingHistory.user_id.in_([player_a, player_b])))).all()} if meetings else {}

    def change(m: RatedMatch, u: str) -> dict | None:
        h = history.get((m.id, u))
        return {"before": round(float(h.rating_before), 2), "after": round(float(h.rating_after), 2), "delta": round(float(h.rating_after) - float(h.rating_before), 3)} if h else None

    def person(u: str) -> dict:
        return {"user_id": "private", "display_name": "Private player"} if u in hidden else {"user_id": u, "display_name": names.get(u, u)}

    matches, summary = [], {k: {"a_wins": 0, "b_wins": 0} for k in ("singles", "doubles")}
    for m in meetings:
        a_side = 1 if player_a in m.side_one else 2
        a_won = m.winner_side == a_side if m.winner_side in (1, 2) else None
        if m.rated and a_won is not None:
            summary[m.kind]["a_wins" if a_won else "b_wins"] += 1
        a_team, b_team = (m.side_one, m.side_two) if a_side == 1 else (m.side_two, m.side_one)
        matches.append({
            "id": str(m.id), "kind": m.kind, "played_at": m.played_at, "score_text": m.score_text if a_side == 1 else flip_score(m.score_text), "outcome": m.outcome, "rated": m.rated, "a_won": a_won,
            "a_partners": [person(u) for u in a_team if u != player_a], "b_partners": [person(u) for u in b_team if u != player_b],
            "a_change": change(m, player_a), "b_change": change(m, player_b),
        })

    ordered_by_kind = {kind: await club_ratings(session, club_id, kind) for kind in ("singles", "doubles")}

    async def player(u: str) -> dict:
        p = profiles.get(u)
        ratings = {}
        for kind, ordered in ordered_by_kind.items():
            row = next((r for r in ordered if r.user_id == u), None)
            ratings[kind] = rating_view(row, ordered.index(row) + 1 if row and row.verified_matches else None)
        return {"user_id": u, "display_name": p.display_name if p else names[u], "image_url": p.image_url if p else None, "city": p.city if p else None, "ratings": ratings}

    return {"a": await player(player_a), "b": await player(player_b), "summary": summary, "matches": matches}
