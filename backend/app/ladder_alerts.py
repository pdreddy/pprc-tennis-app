"""Day-before warnings for ladder challenges that are about to pass their deadline."""
import logging
import os
from datetime import datetime, timedelta, timezone
from html import escape

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .common import notify
from .competitions import OPEN_STATUSES, division_matches, sides
from .emailer import send_email
from .models import Division, Event, PlayerPreference
from .ratings import names_for

logger = logging.getLogger("uvicorn.error")
WARN_BEFORE = timedelta(days=1)


def deadline_email(event_name: str, opponent: str, deadline: datetime, forfeit: bool, link: str) -> str:
    """Fixed template; names are escaped."""
    when = deadline.strftime("%a %b %d, %I:%M %p UTC")
    consequence = "If it is not played, the defender forfeits and the challenger moves up." if forfeit else "If it is not played, the challenge is cancelled."
    return (f'<table role="presentation" width="100%" style="background:#f4f7f9"><tr><td align="center" style="padding:16px 8px">'
            f'<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px"><tr><td style="padding:28px;font-family:Arial,sans-serif;color:#26394a">'
            f'<p style="margin:0;font-size:12px;letter-spacing:2px;color:#087f80">LADDER DEADLINE TOMORROW</p>'
            f'<h1 style="margin:8px 0 12px;font-size:24px;color:#102c43">Your ladder match against {escape(opponent)} is due by {escape(when)}</h1>'
            f'<p style="margin:0 0 20px;color:#26394a">{escape(event_name)}. {consequence} Play it and report the score in the PPRC app to keep your place.</p>'
            f'<p style="margin:0 0 24px"><a href="{escape(link)}" style="background:#102c43;color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700">Open the ladder</a></p>'
            f'<p style="font-size:12px;color:#8a99a6">Sent by PPRC Tennis because you are on this ladder. We never ask for your password or payment details by email.</p>'
            f'</td></tr></table></td></tr></table>')


async def warn_division(session: AsyncSession, division: Division, event_name: str, now: datetime) -> int:
    days = int(division.rules.get("challengeExpiryDays", 0) or 0)
    if days <= 0:
        return 0
    forfeit = division.rules.get("challengeExpiryAction") == "defender_forfeits"
    names = await names_for(session, division.club_id)
    link = f"{os.environ['PPRC_APP_ORIGIN'].rstrip('/')}/ladder"
    warned = 0
    for match in await division_matches(session, division.id):
        if match.round_name != "challenge" or match.status != "scheduled" or match.deadline_warned_at is not None:
            continue
        started = max((v for v in (match.created_at, match.starts_at) if v is not None), default=now)
        deadline = started + timedelta(days=days)
        if not (deadline - WARN_BEFORE <= now < deadline):
            continue
        match.deadline_warned_at = now
        await session.commit()  # stored before sending so restarts never double-send
        one, two = await sides(session, match)
        for mine, theirs in ((one, two), (two, one)):
            opponent = " & ".join(names.get(u, "your opponent") for u in sorted(theirs)) or "your opponent"
            for user_id in mine:
                await notify(session, division.club_id, user_id, "match", "Ladder match due tomorrow", f"Play {opponent} and report the score before the deadline.", {"matchId": str(match.id), "divisionId": str(division.id), "link": "/ladder"})
                prefs = await session.scalar(select(PlayerPreference).where(PlayerPreference.club_id == division.club_id, PlayerPreference.user_id == user_id))
                if prefs and prefs.email:
                    try:
                        await send_email(to=prefs.email, subject=f"Ladder match due tomorrow: {opponent}", html=deadline_email(event_name, opponent, deadline, forfeit, link))
                    except Exception:
                        logger.exception("ladder deadline email failed for %s", match.id)
        await session.commit()
        warned += 1
    return warned


async def warn_all_ladders(session: AsyncSession, now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    rows = (await session.execute(select(Division, Event.name).join(Event, Event.id == Division.event_id).where(Division.format == "ladder", Event.status.in_(OPEN_STATUSES)))).all()
    return sum([await warn_division(session, division, name, now) for division, name in rows])
