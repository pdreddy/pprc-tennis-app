"""Create an idempotent fresh PPRC club in the configured PostgreSQL database.

This is for a brand-new launch. It never reads Firebase and never creates real
player accounts unless --with-demo-players is explicitly supplied.
"""
import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid5

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.database import SessionLocal
from app.models import Club, Division, Event, EventStatus, Membership, MembershipRole

NAMESPACE = UUID("a75111a5-b0f1-4e8f-8b75-5ef16d61101a")


async def ensure_membership(session, club_id: UUID, user_id: str, display_name: str, role: MembershipRole) -> None:
    membership = await session.scalar(select(Membership).where(Membership.club_id == club_id, Membership.user_id == user_id))
    if membership is None:
        session.add(Membership(club_id=club_id, user_id=user_id, display_name=display_name, role=role))


async def ensure_event(session, club_id: UUID, slug: str, name: str, starts_at: datetime, capacity: int, rules: dict) -> Event:
    event_id = uuid5(NAMESPACE, f"event:{slug}")
    event = await session.get(Event, event_id)
    if event is None:
        event = Event(id=event_id, club_id=club_id, name=name, starts_at=starts_at, capacity=capacity, entry_fee_cents=0, status=EventStatus.published, rules=rules)
        session.add(event)
    return event


async def seed(owner_id: str, owner_name: str, demo_players: bool) -> None:
    club_id = uuid5(NAMESPACE, "club:pprc")
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        club = await session.get(Club, club_id)
        if club is None:
            club = Club(id=club_id, slug="pprc", name="Prosper Premier Racquet Club", sport="tennis")
            session.add(club)
        await ensure_membership(session, club_id, owner_id, owner_name, MembershipRole.owner)

        triace = await ensure_event(session, club_id, "triace-2", "TRIACE 2.0", now + timedelta(days=14), 54, {"format": "team", "teamSize": 3, "teamMinRating": 12, "teamMaxRating": 18.5, "minSinglesParticipationPct": 0.4})
        singles = await ensure_event(session, club_id, "pprc-open-singles", "PPRC Open Singles", now + timedelta(days=21), 32, {"format": "round_robin_then_playoff", "playoffSize": 4})
        for event, name, event_format, capacity, rules in (
            (triace, "Open", "triace", 18, {"teamMinRating": 12, "teamMaxRating": 18.5, "minSinglesParticipationPct": 0.4}),
            (singles, "Open Singles", "round_robin", 32, {"playoffSize": 4}),
        ):
            division_id = uuid5(NAMESPACE, f"division:{event.id}:{name}")
            if await session.get(Division, division_id) is None:
                session.add(Division(id=division_id, club_id=club_id, event_id=event.id, name=name, format=event_format, capacity=capacity, rules=rules))
        if demo_players:
            for index in range(1, 13):
                await ensure_membership(session, club_id, f"demo-player-{index}", f"Demo Player {index}", MembershipRole.player)
        await session.commit()
    print(f"Fresh PPRC seed ready for club {club_id}. Owner: {owner_id}. Demo players: {demo_players}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed a fresh PPRC club without importing Firebase data")
    parser.add_argument("--owner-id", required=True, help="Firebase UID of the first PPRC owner")
    parser.add_argument("--owner-name", default="PPRC Owner")
    parser.add_argument("--with-demo-players", action="store_true")
    args = parser.parse_args()
    asyncio.run(seed(args.owner_id, args.owner_name, args.with_demo_players))
