"""Weekly PPRC Rating recap email: automatic on Monday 8:00 America/Chicago, or sent by a club admin."""
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from html import escape
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import Actor, current_actor
from .common import audit
from .database import SessionLocal, get_session
from .emailer import send_email
from .members import fair_matches, require_club_admin
from .models import Club, PlayerPreference, PlayerProfile, RatedMatch, RatingHistory
from .ratings import club_ratings, require_member

logger = logging.getLogger(__name__)
router = APIRouter()
CLUB_TZ = ZoneInfo("America/Chicago")
_self_sends: dict[str, datetime] = {}


def week_key(now: datetime | None = None) -> str:
    year, week, _ = (now or datetime.now(CLUB_TZ)).astimezone(CLUB_TZ).isocalendar()
    return f"{year}-W{week:02d}"


async def recap_data(session: AsyncSession, club_id: UUID, user_id: str) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=7)
    out = {"kinds": [], "opponents": await fair_matches(session, club_id, user_id, "singles", 0.5, 3)}
    for kind in ("singles", "doubles"):
        ordered = await club_ratings(session, club_id, kind)
        rated = [r for r in ordered if r.verified_matches]
        mine = next((r for r in rated if r.user_id == user_id), None)
        if mine is None:
            continue
        week = list((await session.scalars(select(RatingHistory).where(RatingHistory.club_id == club_id, RatingHistory.kind == kind, RatingHistory.played_at > since).order_by(RatingHistory.played_at))).all())
        then = {r.user_id: float(r.rating) for r in rated}
        for h in reversed(week):
            then[h.user_id] = float(h.rating_before)
        previous = sorted(then, key=lambda u: -then[u])
        mine_week = [h for h in week if h.user_id == user_id]
        matches = [m for m in (await session.scalars(select(RatedMatch).where(RatedMatch.club_id == club_id, RatedMatch.kind == kind, RatedMatch.status == "finalized", RatedMatch.rated.is_(True), RatedMatch.played_at > since))).all() if user_id in m.side_one or user_id in m.side_two]
        wins = sum(1 for m in matches if (m.winner_side == 1) == (user_id in m.side_one))
        rank = rated.index(mine) + 1
        out["kinds"].append({
            "kind": kind, "rating": float(mine.rating), "change": float(mine.rating) - then[user_id] if mine_week else 0.0,
            "rank": rank, "movement": (previous.index(user_id) + 1) - rank, "field": len(rated),
            "wins": wins, "losses": len(matches) - wins, "provisional": mine.provisional,
        })
    return out


def recap_html(name: str, data: dict, app_url: str) -> str:
    """Fixed server-side template; every interpolated value is escaped."""
    rows = ""
    for k in data["kinds"]:
        arrow = f"up {k['movement']}" if k["movement"] > 0 else f"down {-k['movement']}" if k["movement"] < 0 else "no change"
        sign = "+" if k["change"] >= 0 else ""
        rows += (f'<tr><td style="padding:14px 0;border-top:1px solid #e3e9ee"><strong style="font-size:15px;color:#102c43">{escape(k["kind"].title())}</strong>'
                 f'{" · Provisional" if k["provisional"] else ""}<br><span style="font-size:30px;font-weight:700;color:#102c43">{k["rating"]:.2f}</span> '
                 f'<span style="color:{"#0b6b4b" if k["change"] >= 0 else "#a32727"};font-weight:700">{sign}{k["change"]:.2f} this week</span><br>'
                 f'<span style="color:#637586">Club rank #{k["rank"]} of {k["field"]} ({arrow}) · {k["wins"]}-{k["losses"]} this week</span></td></tr>')
    if not rows:
        rows = '<tr><td style="padding:14px 0;color:#637586">No verified matches yet. Report your first match to start your PPRC Rating.</td></tr>'
    opponents = "".join(f'<li style="margin:4px 0">{escape(o["display_name"])} · {o["rating"]:.2f} ({"+" if o["gap"] >= 0 else ""}{o["gap"]:.2f})</li>' for o in data["opponents"])
    opp_block = f'<p style="margin:18px 0 6px;font-weight:700;color:#102c43">Fair matches for you this week</p><ul style="margin:0;padding-left:18px;color:#26394a">{opponents}</ul>' if opponents else ""
    link = escape(f"{app_url}/me/rating")
    return (f'<table role="presentation" width="100%" style="background:#f4f7f9"><tr><td align="center" style="padding:24px">'
            f'<table role="presentation" width="560" style="max-width:560px;background:#ffffff;border-radius:14px"><tr><td style="padding:28px;font-family:Arial,sans-serif;color:#26394a">'
            f'<p style="margin:0;font-size:12px;letter-spacing:2px;color:#087f80">PPRC WEEKLY RATING RECAP</p>'
            f'<h1 style="margin:8px 0 4px;font-size:24px;color:#102c43">Hi {escape(name)}, here is your week</h1>'
            f'<table role="presentation" width="100%">{rows}</table>{opp_block}'
            f'<p style="margin:24px 0"><a href="{link}" style="background:#102c43;color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700">Open My rating</a></p>'
            f'<p style="font-size:12px;color:#8a99a6">Sent by PPRC Tennis because you turned on the weekly recap. Turn it off any time under My rating, Edit profile. '
            f'We never ask for your password or payment details by email.</p></td></tr></table></td></tr></table>')


async def send_recap(session: AsyncSession, club_id: UUID, prefs: PlayerPreference) -> None:
    profile = await session.scalar(select(PlayerProfile).where(PlayerProfile.club_id == club_id, PlayerProfile.user_id == prefs.user_id))
    name = profile.display_name if profile else "there"
    html = recap_html(name, await recap_data(session, club_id, prefs.user_id), os.environ["PPRC_APP_ORIGIN"].rstrip("/"))
    await send_email(to=prefs.email, subject="Your PPRC weekly rating recap", html=html)


async def send_club_recaps(session: AsyncSession, club_id: UUID) -> dict:
    """One email per opted-in member with a verified address, at most once per week (idempotent)."""
    key, sent, failed = week_key(), 0, 0
    recipients = (await session.scalars(select(PlayerPreference).where(PlayerPreference.club_id == club_id, PlayerPreference.weekly_recap.is_(True), PlayerPreference.email.is_not(None)))).all()
    for prefs in recipients:
        if prefs.recap_sent_week == key:
            continue
        try:
            await send_recap(session, club_id, prefs)
            prefs.recap_sent_week = key
            sent += 1
            await session.commit()
        except HTTPException as exc:
            failed += 1
            if exc.status_code == 503:
                break  # owner billing state: stop for now, the next run resumes
    return {"week": key, "sent": sent, "failed": failed, "opted_in": len(recipients)}


@router.post("/v1/clubs/{club_id}/recaps/send")
async def send_recaps_now(club_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    await require_club_admin(session, club_id, actor)
    result = await send_club_recaps(session, club_id)
    await audit(session, club_id, actor.user_id, "recap.sent", "club", str(club_id), f"{result['sent']} sent")
    await session.commit()
    return result


@router.post("/v1/clubs/{club_id}/recaps/me")
async def send_my_recap(club_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Send yourself this week's recap now (to your verified sign-in email). Limited to once an hour."""
    await require_member(session, club_id, actor.user_id)
    prefs = await session.scalar(select(PlayerPreference).where(PlayerPreference.club_id == club_id, PlayerPreference.user_id == actor.user_id))
    if prefs is None or not prefs.email:
        raise HTTPException(status_code=409, detail="Sign in with a verified email to receive recaps")
    last = _self_sends.get(actor.user_id)
    if last and datetime.now(timezone.utc) - last < timedelta(hours=1):
        raise HTTPException(status_code=429, detail="You can send yourself a recap once an hour")
    await send_recap(session, club_id, prefs)
    _self_sends[actor.user_id] = datetime.now(timezone.utc)
    return {"sent_to": prefs.email}


async def weekly_scheduler(stop: asyncio.Event) -> None:
    """Every 15 minutes: on Monday from 8:00 Chicago time, send any recaps not yet sent this week."""
    while not stop.is_set():
        now = datetime.now(CLUB_TZ)
        if now.weekday() == 0 and now.hour >= 8:
            try:
                async with SessionLocal() as session:
                    for club_id in (await session.scalars(select(Club.id))).all():
                        logger.info("weekly recap %s: %s", club_id, await send_club_recaps(session, club_id))
            except Exception:
                logger.exception("weekly recap run failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=900)
        except asyncio.TimeoutError:
            pass
