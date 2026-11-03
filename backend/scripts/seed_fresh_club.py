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
from app.models import Club, Division, DivisionEntry, Event, EventStatus, Membership, MembershipRole, PlayerProfile, RatedMatch
from app.rating_service import recalculate_club, score_fields

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


DEMO_CITIES = ["Prosper", "Frisco", "Celina", "McKinney"]
DEMO_AGE = ["Adult 18+", "Adult 35+", "Junior 14-17", "Adult 50+"]


async def seed_rating_demo(session, club_id: UUID, now: datetime) -> None:
    """Demo-only profiles, verified sample results and a sample ladder. Idempotent."""
    for index in range(1, 17):
        user_id = f"player{index}"
        if await session.scalar(select(PlayerProfile).where(PlayerProfile.club_id == club_id, PlayerProfile.user_id == user_id)) is None:
            start = round(3.5 + (16 - index) * 0.5, 2)
            session.add(PlayerProfile(
                club_id=club_id, user_id=user_id, display_name=f"Demo Player {index}", city=DEMO_CITIES[index % 4], state="TX",
                home_club="Prosper Premier Racquet Club", age_group=DEMO_AGE[index % 4], gender_category="Open",
                visibility="private" if index == 16 else "public" if index % 3 else "club", starting_singles=start, starting_doubles=start,
            ))
    scores = ["6-3 6-4", "6-4 3-6 10-7", "7-5 6-2", "6-2 6-1", "4-6 6-3 10-8", "6-7 6-4 10-6"]
    for n in range(24):
        a, b = 1 + (n * 5) % 16, 1 + (n * 7 + 3) % 16
        if a == b:
            continue
        source_id = f"seed-result-{n}"
        if await session.scalar(select(RatedMatch.id).where(RatedMatch.source_id == source_id)) is None:
            doubles = n % 6 == 5
            side_one = [f"player{a}", f"player{1 + a % 16}"] if doubles else [f"player{a}"]
            side_two = [f"player{b}", f"player{1 + (b + 7) % 16}"] if doubles else [f"player{b}"]
            if set(side_one) & set(side_two):
                continue
            score = scores[n % len(scores)]
            fields = score_fields(score, "completed", None)
            session.add(RatedMatch(club_id=club_id, source="reported", source_id=source_id, kind="doubles" if doubles else "singles", side_one=side_one, side_two=side_two, score_text=score, match_format="best_of_3", played_at=now - timedelta(days=60 - n * 2), status="finalized", reported_by=side_one[0], confirmed_by=side_two[0], **fields))
    ladder = await ensure_event(session, club_id, "pprc-ladder", "PPRC Singles Ladder", now - timedelta(days=7), 32, {"description": "Season-long singles ladder. Challenge up to 3 places above you."})
    division_id = uuid5(NAMESPACE, f"division:{ladder.id}:Ladder")
    if await session.get(Division, division_id) is None:
        session.add(Division(id=division_id, club_id=club_id, event_id=ladder.id, name="Ladder", format="ladder", capacity=32, rules={"entryType": "singles", "challengeRange": 3, "challengeExpiryDays": 14, "challengeExpiryAction": "cancel"}))
        await session.flush()
        for rank, index in enumerate(range(1, 9), start=1):
            session.add(DivisionEntry(club_id=club_id, division_id=division_id, user_id=f"player{index}", display_name=f"Demo Player {index}", rank=rank))
    await session.flush()
    await recalculate_club(session, club_id)


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
            # These IDs deliberately match functions/src/seed.ts so that the
            # Firebase emulator accounts can use the FastAPI club immediately.
            for index in range(1, 17):
                await ensure_membership(session, club_id, f"player{index}", f"Demo Player {index}", MembershipRole.player)
            await session.flush()
            await seed_rating_demo(session, club_id, now)
        await session.commit()
    print(f"Fresh PPRC seed ready for club {club_id}. Owner: {owner_id}. Demo players: {demo_players}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed a fresh PPRC club without importing Firebase data")
    parser.add_argument("--owner-id", required=True, help="Firebase UID of the first PPRC owner")
    parser.add_argument("--owner-name", default="PPRC Owner")
    parser.add_argument("--with-demo-players", action="store_true")
    args = parser.parse_args()
    asyncio.run(seed(args.owner_id, args.owner_name, args.with_demo_players))
