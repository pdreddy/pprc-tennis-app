"""Weekly PPRC Rating recap email: automatic on Monday 8:00 America/Chicago, or sent by a club admin."""
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from html import escape
from uuid import UUID
from zoneinfo import ZoneInfo

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import Actor, current_actor
from .common import audit
from .database import SessionLocal, get_session
from .digest import digest_data, digest_html, digest_subject, month_window, send_club_digests
from .emailer import send_email
from .members import fair_matches, require_club_admin
from .models import Club, PlayerPreference, PlayerProfile, RatedMatch, RatingHistory
from .ratings import club_ratings, require_member

logger = logging.getLogger("uvicorn.error")  # shows up in the server log
router = APIRouter()
CLUB_TZ = ZoneInfo("America/Chicago")


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
        matches = [m for m in matches if m.winner_side in (1, 2)]
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
    return (f'<table role="presentation" width="100%" style="background:#f4f7f9"><tr><td align="center" style="padding:16px 8px">'
            f'<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px"><tr><td style="padding:28px;font-family:Arial,sans-serif;color:#26394a">'
            f'<p style="margin:0;font-size:12px;letter-spacing:2px;color:#087f80">PPRC WEEKLY RATING RECAP</p>'
            f'<h1 style="margin:8px 0 4px;font-size:24px;color:#102c43">Hi {escape(name)}, here is your week</h1>'
            f'<table role="presentation" width="100%">{rows}</table>{opp_block}'
            f'<p style="margin:24px 0"><a href="{link}" style="background:#102c43;color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700">Open My rating</a></p>'
            f'<p style="font-size:12px;color:#8a99a6">Sent by PPRC Tennis because you turned on the weekly recap. Turn it off any time under My rating, Edit profile. '
            f'We never ask for your password or payment details by email.</p></td></tr></table></td></tr></table>')


RECAP_SUBJECT = "Your PPRC weekly rating recap"


async def recap_for(session: AsyncSession, club_id: UUID, user_id: str) -> str:
    profile = await session.scalar(select(PlayerProfile).where(PlayerProfile.club_id == club_id, PlayerProfile.user_id == user_id))
    name = profile.display_name if profile else "there"
    return recap_html(name, await recap_data(session, club_id, user_id), os.environ["PPRC_APP_ORIGIN"].rstrip("/"))


async def send_recap(session: AsyncSession, club_id: UUID, prefs: PlayerPreference) -> None:
    await send_email(to=prefs.email, subject=RECAP_SUBJECT, html=await recap_for(session, club_id, prefs.user_id))


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
            if exc.status_code in (429, 503):
                break  # owner billing state: stop for now, the next run resumes
        except Exception:
            failed += 1  # one bad recipient never stops the batch
            logger.exception("weekly recap failed for %s", prefs.user_id)
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
    last = prefs.last_self_recap_at
    if last and datetime.now(timezone.utc) - last < timedelta(hours=1):
        raise HTTPException(status_code=429, detail="You can send yourself a recap once an hour")
    prefs.last_self_recap_at = datetime.now(timezone.utc)
    await session.commit()  # stored before sending so restarts or extra workers cannot double-send
    try:
        await send_recap(session, club_id, prefs)
    except Exception:
        prefs.last_self_recap_at = last  # a failed send should not lock the player out for an hour
        await session.commit()
        raise
    return {"sent_to": prefs.email}


class PreviewInput(BaseModel):
    type: Literal["weekly", "monthly"] = "weekly"
    user_id: str | None = None


async def render_preview(session: AsyncSession, club_id: UUID, actor: Actor, kind: str, user_id: str | None) -> dict:
    """Weekly: the chosen member's recap as it would go out now. Monthly: this month so far (sent on the 1st)."""
    if kind == "weekly":
        target = user_id or actor.user_id
        await require_member(session, club_id, target)
        opted = PlayerPreference.weekly_recap
        subject, html = RECAP_SUBJECT, await recap_for(session, club_id, target)
    else:
        start, end, _ = month_window(previous=False)
        data = await digest_data(session, club_id, start, end)
        me = await session.scalar(select(PlayerProfile.display_name).where(PlayerProfile.club_id == club_id, PlayerProfile.user_id == actor.user_id))
        opted = PlayerPreference.monthly_digest
        subject, html = await digest_subject(session, club_id, data["label"]), digest_html(me or "there", data, os.environ["PPRC_APP_ORIGIN"].rstrip("/"), so_far=True)
    recipients = (await session.scalars(select(PlayerPreference.id).where(PlayerPreference.club_id == club_id, opted.is_(True), PlayerPreference.email.is_not(None)))).all()
    return {"type": kind, "subject": subject, "html": html, "recipients": len(recipients)}


@router.get("/v1/clubs/{club_id}/emails/preview")
async def preview_email(club_id: UUID, type: Literal["weekly", "monthly"] = "weekly", user_id: str | None = Query(None, max_length=128), session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    await require_club_admin(session, club_id, actor)
    return await render_preview(session, club_id, actor, type, user_id)


@router.post("/v1/clubs/{club_id}/emails/test")
async def send_test_email(club_id: UUID, payload: PreviewInput, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Email the previewed recap or digest to the admin's own verified address only. Once a minute."""
    await require_club_admin(session, club_id, actor)
    prefs = await session.scalar(select(PlayerPreference).where(PlayerPreference.club_id == club_id, PlayerPreference.user_id == actor.user_id))
    if prefs is None or not prefs.email:
        raise HTTPException(status_code=409, detail="Sign in with a verified email to receive test emails")
    last = prefs.last_test_email_at
    if last and datetime.now(timezone.utc) - last < timedelta(minutes=1):
        raise HTTPException(status_code=429, detail="Wait a minute before sending another test")
    preview = await render_preview(session, club_id, actor, payload.type, payload.user_id)
    prefs.last_test_email_at = datetime.now(timezone.utc)
    await session.commit()
    try:
        await send_email(to=prefs.email, subject=f"Test: {preview['subject']}", html=preview["html"])
    except Exception:
        prefs.last_test_email_at = last
        await session.commit()
        raise
    await audit(session, club_id, actor.user_id, "email.test_sent", "club", str(club_id), payload.type)
    await session.commit()
    return {"sent_to": prefs.email, "type": payload.type}


async def weekly_scheduler(stop: asyncio.Event) -> None:
    """Every 15 minutes: Monday from 8:00 Chicago sends weekly recaps; the 1st from 8:00 sends last month's leaderboard."""
    while not stop.is_set():
        now = datetime.now(CLUB_TZ)
        try:
            from .challenges import challenge_maintenance

            async with SessionLocal() as session:
                for club_id in (await session.scalars(select(Club.id))).all():
                    done = await challenge_maintenance(session, club_id)
                    if done["reminded"] or done["expired"]:
                        logger.info("challenges %s: %s", club_id, done)
        except Exception:
            logger.exception("challenge reminders failed")
        try:
            from .competitions import expire_all_ladders
            from .ladder_alerts import warn_all_ladders

            async with SessionLocal() as session:
                if warned := await warn_all_ladders(session):
                    logger.info("ladder deadline warnings sent for %s match(es)", warned)
                expired = await expire_all_ladders(session)
                if expired:
                    logger.info("ladder deadlines applied in %s division(s)", expired)
        except Exception:
            logger.exception("ladder expiry failed")
        if (now.weekday() == 0 or now.day == 1) and now.hour >= 8:
            try:
                async with SessionLocal() as session:
                    for club_id in (await session.scalars(select(Club.id))).all():
                        if now.weekday() == 0:
                            if (done := await send_club_recaps(session, club_id))["sent"] or done["failed"]:
                                logger.info("weekly recap %s: %s", club_id, done)
                        if now.day == 1:
                            if (done := await send_club_digests(session, club_id))["sent"] or done["failed"]:
                                logger.info("monthly digest %s: %s", club_id, done)
            except Exception:
                logger.exception("scheduled email run failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=900)
        except asyncio.TimeoutError:
            pass
