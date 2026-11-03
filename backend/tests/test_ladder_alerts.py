"""Day-before ladder deadline warning (in-process, fake clock)."""
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("PPRC_APP_ORIGIN", "https://example.com")

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.ladder_alerts import warn_all_ladders  # noqa: E402
from app.models import Base, Club, CompetitionMatch, Division, Event, EventStatus, Membership, MembershipRole, Notification  # noqa: E402


async def test_ladder_warning_once_in_the_last_day():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with Session() as s:
        club = Club(slug="l", name="L")
        s.add(club)
        await s.flush()
        event = Event(club_id=club.id, name="Spring Ladder", starts_at=start, status=EventStatus.published)
        s.add(event)
        await s.flush()
        division = Division(club_id=club.id, event_id=event.id, name="Open", format="ladder", rules={"challengeExpiryDays": 3})
        s.add(division)
        await s.flush()
        s.add_all([Membership(club_id=club.id, user_id=u, display_name=u.upper(), role=MembershipRole.player) for u in ("a", "b")])
        s.add(CompetitionMatch(club_id=club.id, division_id=division.id, round_name="challenge", player_one_id="a", player_two_id="b", status="scheduled", created_at=start))
        s.add(CompetitionMatch(club_id=club.id, division_id=division.id, round_name="challenge", player_one_id="b", player_two_id="a", status="reported", created_at=start))
        await s.commit()
        assert await warn_all_ladders(s, start + timedelta(days=1)) == 0
        assert await warn_all_ladders(s, start + timedelta(days=2, hours=1)) == 1  # reported matches are not warned
        assert await warn_all_ladders(s, start + timedelta(days=2, hours=5)) == 0
        notes = (await s.scalars(select(Notification).where(Notification.title == "Ladder match due tomorrow"))).all()
        assert sorted(n.user_id for n in notes) == ["a", "b"] and "Play B" in next(n.body for n in notes if n.user_id == "a")
        assert await warn_all_ladders(s, start + timedelta(days=4)) == 0  # past the deadline: expiry handles it
    await engine.dispose()
