"""Monthly club leaderboard email: biggest climbers, new milestones and the top of the rankings."""
import logging
import os
from datetime import datetime, timedelta, timezone
from html import escape
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .emailer import send_email
from .models import Club, Membership, PlayerPreference, PlayerProfile, RatedMatch, RatingHistory
from .rating_service import milestones_for
from .ratings import club_ratings, names_for

logger = logging.getLogger("uvicorn.error")
CLUB_TZ = ZoneInfo("America/Chicago")


def month_window(now: datetime | None = None, previous: bool = True) -> tuple[datetime, datetime, str]:
    """(start, end, 'YYYY-MM') of the previous month (what the 1st-of-month email covers) or the current month so far."""
    local = (now or datetime.now(CLUB_TZ)).astimezone(CLUB_TZ)
    this_month = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    start = (this_month - timedelta(days=1)).replace(day=1) if previous else this_month
    end = this_month if previous else local
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc), start.strftime("%Y-%m")


async def digest_data(session: AsyncSession, club_id: UUID, start: datetime, end: datetime) -> dict:
    """Club-wide, so private players are always left out."""
    private = set((await session.scalars(select(PlayerProfile.user_id).where(PlayerProfile.club_id == club_id, PlayerProfile.visibility == "private"))).all())
    members = set((await session.scalars(select(Membership.user_id).where(Membership.club_id == club_id))).all())
    names = await names_for(session, club_id)
    history = list((await session.scalars(select(RatingHistory).where(RatingHistory.club_id == club_id, RatingHistory.played_at >= start, RatingHistory.played_at < end).order_by(RatingHistory.played_at))).all())
    climbers, leaders = [], {}
    for kind in ("singles", "doubles"):
        first, last = {}, {}
        for h in history:
            if h.kind == kind and h.user_id in members and h.user_id not in private:
                first.setdefault(h.user_id, float(h.rating_before))
                last[h.user_id] = float(h.rating_after)
        climbers += [{"user_id": u, "display_name": names.get(u, u), "kind": kind, "from": round(first[u], 2), "to": round(last[u], 2), "gain": round(last[u] - first[u], 2)} for u in last if last[u] - first[u] >= 0.005]
        rated = [r for r in await club_ratings(session, club_id, kind) if r.verified_matches and r.user_id in members and r.user_id not in private]
        leaders[kind] = [{"rank": i + 1, "display_name": names.get(r.user_id, r.user_id), "rating": round(float(r.rating), 2), "provisional": r.provisional} for i, r in enumerate(rated[:5])]
    climbers.sort(key=lambda c: -c["gain"])
    milestones = []
    for u in sorted({h.user_id for h in history} & members - private):
        milestones += [{"display_name": names.get(u, u), "title": m["title"], "detail": m["detail"]} for m in await milestones_for(session, club_id, u) if start <= m["date"] < end]
    played = (await session.scalars(select(RatedMatch.id).where(RatedMatch.club_id == club_id, RatedMatch.status == "finalized", RatedMatch.rated.is_(True), RatedMatch.played_at >= start, RatedMatch.played_at < end))).all()
    return {"climbers": climbers[:5], "milestones": milestones[:8], "leaders": leaders, "matches": len(played), "label": start.astimezone(CLUB_TZ).strftime("%B %Y")}


def digest_html(name: str, data: dict, app_url: str, so_far: bool = False) -> str:
    """Fixed server-side template; every interpolated value is escaped."""
    h2 = 'style="margin:22px 0 8px;font-size:16px;color:#102c43"'
    climbers = "".join(f'<li style="margin:5px 0">{escape(c["display_name"])} <span style="color:#637586">({escape(c["kind"])})</span> {c["from"]:.2f} to <strong>{c["to"]:.2f}</strong> <span style="color:#0b6b4b;font-weight:700">+{c["gain"]:.2f}</span></li>' for c in data["climbers"])
    milestones = "".join(f'<li style="margin:5px 0"><strong>{escape(m["display_name"])}</strong>: {escape(m["title"])} <span style="color:#637586">· {escape(m["detail"])}</span></li>' for m in data["milestones"])
    tables = ""
    for kind, rows in data["leaders"].items():
        if rows:
            body = "".join(f'<tr><td style="padding:4px 10px 4px 0;color:#637586">#{r["rank"]}</td><td style="padding:4px 10px 4px 0">{escape(r["display_name"])}</td><td style="padding:4px 0;font-weight:700">{r["rating"]:.2f}{" P" if r["provisional"] else ""}</td></tr>' for r in rows)
            tables += f'<p {h2}>Top 5 · {escape(kind.title())}</p><table role="presentation">{body}</table>'
    empty = '<p style="color:#637586">A quiet month. Report a match to get on next month\'s list.</p>'
    title = f"{data['label']} so far" if so_far else data["label"]
    link = escape(f"{app_url}/rankings")
    return (f'<table role="presentation" width="100%" style="background:#f4f7f9"><tr><td align="center" style="padding:16px 8px">'
            f'<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px"><tr><td style="padding:28px;font-family:Arial,sans-serif;color:#26394a">'
            f'<p style="margin:0;font-size:12px;letter-spacing:2px;color:#087f80">PPRC MONTHLY LEADERBOARD</p>'
            f'<h1 style="margin:8px 0 4px;font-size:24px;color:#102c43">{escape(title)} at the club</h1>'
            f'<p style="margin:0;color:#637586">Hi {escape(name)}, {data["matches"]} rated matches were played.</p>'
            f'<p {h2}>Biggest climbers</p>' + (f'<ol style="margin:0;padding-left:20px">{climbers}</ol>' if climbers else empty) +
            (f'<p {h2}>New milestones</p><ul style="margin:0;padding-left:20px">{milestones}</ul>' if milestones else "") + tables +
            f'<p style="margin:24px 0"><a href="{link}" style="background:#102c43;color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700">See full rankings</a></p>'
            f'<p style="font-size:12px;color:#8a99a6">Sent by PPRC Tennis because you turned on the monthly club email. Private players are never listed. Turn it off any time under My rating, Edit profile. '
            f'We never ask for your password or payment details by email.</p></td></tr></table></td></tr></table>')


async def digest_subject(session: AsyncSession, club_id: UUID, label: str) -> str:
    club = await session.get(Club, club_id)
    return f"{club.name if club else 'PPRC'} leaderboard · {label}"


async def send_club_digests(session: AsyncSession, club_id: UUID, now: datetime | None = None) -> dict:
    """Previous month's digest, once per opted-in member per month (idempotent)."""
    start, end, key = month_window(now)
    data = await digest_data(session, club_id, start, end)
    subject = await digest_subject(session, club_id, data["label"])
    profiles = {p.user_id: p.display_name for p in (await session.scalars(select(PlayerProfile).where(PlayerProfile.club_id == club_id))).all()}
    recipients = (await session.scalars(select(PlayerPreference).where(PlayerPreference.club_id == club_id, PlayerPreference.monthly_digest.is_(True), PlayerPreference.email.is_not(None)))).all()
    sent = failed = 0
    app_url = os.environ["PPRC_APP_ORIGIN"].rstrip("/")
    for prefs in recipients:
        if prefs.digest_sent_month == key:
            continue
        try:
            await send_email(to=prefs.email, subject=subject, html=digest_html(profiles.get(prefs.user_id, "there"), data, app_url))
            prefs.digest_sent_month = key
            sent += 1
            await session.commit()
        except HTTPException as exc:
            failed += 1
            if exc.status_code in (429, 503):
                break
        except Exception:
            failed += 1
            logger.exception("monthly digest failed for %s", prefs.user_id)
    return {"month": key, "sent": sent, "failed": failed, "opted_in": len(recipients)}
