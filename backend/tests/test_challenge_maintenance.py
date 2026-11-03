"""Reminder after 2 quiet days, expiry after the club's configured days (in-process, fake clock)."""
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("PPRC_APP_ORIGIN", "https://example.com")

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.challenges import challenge_maintenance  # noqa: E402
from app.models import Base, Challenge, Club, Membership, MembershipRole, Notification  # noqa: E402


async def test_reminder_once_then_expiry():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with Session() as s:
        club = Club(slug="m", name="M", challenge_expiry_days=5)
        s.add(club)
        await s.flush()
        s.add_all([Membership(club_id=club.id, user_id=u, display_name=u.upper(), role=MembershipRole.player) for u in ("a", "b")])
        c = Challenge(club_id=club.id, challenger_id="a", opponent_id="b", status="pending", awaiting_id="b", last_action_at=start, created_at=start)
        s.add(c)
        await s.commit()
        assert await challenge_maintenance(s, club.id, start + timedelta(days=1)) == {"reminded": 0, "expired": 0}
        assert await challenge_maintenance(s, club.id, start + timedelta(days=2, hours=1)) == {"reminded": 1, "expired": 0}
        assert await challenge_maintenance(s, club.id, start + timedelta(days=3)) == {"reminded": 0, "expired": 0}
        notes = (await s.scalars(select(Notification).where(Notification.user_id == "b"))).all()
        assert [n.title for n in notes] == ["Reminder: A is waiting"]
        assert await challenge_maintenance(s, club.id, start + timedelta(days=5, minutes=1)) == {"reminded": 0, "expired": 1}
        await s.refresh(c)
        assert c.status == "expired" and c.awaiting_id is None
        titles = {n.user_id: n.title for n in (await s.scalars(select(Notification).where(Notification.title.like("%expired")))).all()}
        assert titles == {"a": "Your challenge expired", "b": "A challenge expired"}
    await engine.dispose()


async def test_expiry_counts_from_sending_unless_club_restarts_it():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    sent = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with Session() as s:
        club = Club(slug="r", name="R", challenge_expiry_days=4)
        s.add(club)
        await s.flush()
        s.add_all([Membership(club_id=club.id, user_id=u, display_name=u, role=MembershipRole.player) for u in ("a", "b")])
        c = Challenge(club_id=club.id, challenger_id="a", opponent_id="b", status="pending", awaiting_id="a", created_at=sent, last_action_at=sent + timedelta(days=3))
        s.add(c)
        await s.commit()
        assert (await challenge_maintenance(s, club.id, sent + timedelta(days=4, minutes=1)))["expired"] == 1  # a new time did not extend it
        c.status, club.challenge_expiry_restarts = "pending", True
        await s.commit()
        assert (await challenge_maintenance(s, club.id, sent + timedelta(days=4, minutes=2)))["expired"] == 0  # restart mode: 4 days from the last suggestion
        assert (await challenge_maintenance(s, club.id, sent + timedelta(days=7, minutes=1)))["expired"] == 1
    await engine.dispose()
