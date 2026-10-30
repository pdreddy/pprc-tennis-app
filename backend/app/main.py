from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .database import engine, get_session
from .auth import Actor, current_actor
from .models import (
    AuditLog,
    Base,
    Club,
    Division,
    Event,
    EventStatus,
    Fixture,
    FixtureStatus,
    Membership,
    MembershipRole,
    Registration,
    RegistrationStatus,
    Standing,
    Team,
    TeamMember,
    TeamStatus,
)
from .schemas import (
    ClubCreate,
    ClubRead,
    DivisionCreate,
    DivisionRead,
    EventCreate,
    EventRead,
    FixtureCreate,
    FixtureRead,
    FixtureResult,
    MembershipCreate,
    MembershipRead,
    RegistrationRead,
    TeamCreate,
    TeamRead,
)


async def audit(session: AsyncSession, club_id: UUID, actor: str, action: str, entity_type: str, entity_id: str) -> None:
    session.add(AuditLog(club_id=club_id, actor_id=actor, action=action, entity_type=entity_type, entity_id=entity_id))


async def require_role(session: AsyncSession, club_id: UUID, actor: str, roles: set[MembershipRole]) -> Membership:
    membership = await session.scalar(select(Membership).where(Membership.club_id == club_id, Membership.user_id == actor))
    if membership is None or membership.role not in roles:
        raise HTTPException(status_code=403, detail="Club role is not permitted")
    return membership


async def rebuild_team_standings(session: AsyncSession, club_id: UUID, division_id: UUID) -> None:
    """Recalculate standings from finalized fixtures, keeping corrections deterministic."""
    await session.execute(
        Standing.__table__.delete().where(
            Standing.club_id == club_id,
            Standing.division_id == division_id,
            Standing.subject_type == "team",
        )
    )
    fixtures = list(
        (
            await session.scalars(
                select(Fixture).where(
                    Fixture.club_id == club_id,
                    Fixture.division_id == division_id,
                    Fixture.status == FixtureStatus.finalized,
                )
            )
        ).all()
    )
    totals: dict[UUID, dict[str, int]] = {}
    for fixture in fixtures:
        for team_id in (fixture.home_team_id, fixture.away_team_id):
            totals.setdefault(team_id, {"played": 0, "wins": 0, "losses": 0, "points": 0})
            totals[team_id]["played"] += 1
        if fixture.winner_team_id:
            loser = fixture.away_team_id if fixture.winner_team_id == fixture.home_team_id else fixture.home_team_id
            totals[fixture.winner_team_id]["wins"] += 1
            totals[fixture.winner_team_id]["points"] += 3
            totals[loser]["losses"] += 1
    for team_id, values in totals.items():
        session.add(
            Standing(
                club_id=club_id,
                division_id=division_id,
                subject_type="team",
                subject_id=str(team_id),
                **values,
            )
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    if get_settings().pprc_bootstrap_schema:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(title="PPRC Multi-club API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "pprc-api"}


@app.post("/v1/clubs", response_model=ClubRead, status_code=status.HTTP_201_CREATED)
async def create_club(payload: ClubCreate, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> Club:
    if await session.scalar(select(Club).where(Club.slug == payload.slug)):
        raise HTTPException(status_code=409, detail="Club slug already exists")
    club = Club(**payload.model_dump())
    session.add(club)
    await session.flush()
    session.add(Membership(club_id=club.id, user_id=actor.user_id, display_name=actor.name or actor.email or actor.user_id, role=MembershipRole.owner))
    await audit(session, club.id, actor.user_id, "club.created", "club", str(club.id))
    await session.commit()
    return club


@app.get("/v1/clubs", response_model=list[ClubRead])
async def list_clubs(session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[Club]:
    return list((await session.scalars(select(Club).join(Membership).where(Membership.user_id == actor.user_id).order_by(Club.name))).all())


@app.post("/v1/clubs/{club_id}/memberships", response_model=MembershipRead, status_code=status.HTTP_201_CREATED)
async def add_membership(club_id: UUID, payload: MembershipCreate, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> Membership:
    await require_role(session, club_id, actor.user_id, {MembershipRole.owner, MembershipRole.admin})
    member = Membership(club_id=club_id, **payload.model_dump())
    session.add(member)
    try:
        await session.flush()
    except Exception as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail="Membership already exists") from exc
    await audit(session, club_id, actor.user_id, "membership.created", "membership", str(member.id))
    await session.commit()
    return member


@app.post("/v1/clubs/{club_id}/events", response_model=EventRead, status_code=status.HTTP_201_CREATED)
async def create_event(club_id: UUID, payload: EventCreate, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> Event:
    await require_role(session, club_id, actor.user_id, {MembershipRole.owner, MembershipRole.admin, MembershipRole.organizer})
    event = Event(club_id=club_id, **payload.model_dump())
    session.add(event)
    await session.flush()
    await audit(session, club_id, actor.user_id, "event.created", "event", str(event.id))
    await session.commit()
    return event


@app.get("/v1/clubs/{club_id}/events", response_model=list[EventRead])
async def list_events(club_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[Event]:
    await require_role(session, club_id, actor.user_id, set(MembershipRole))
    return list((await session.scalars(select(Event).where(Event.club_id == club_id).order_by(Event.starts_at))).all())


@app.post("/v1/events/{event_id}/publish", response_model=EventRead)
async def publish_event(event_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> Event:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    await require_role(session, event.club_id, actor.user_id, {MembershipRole.owner, MembershipRole.admin, MembershipRole.organizer})
    event.status = EventStatus.published
    await audit(session, event.club_id, actor.user_id, "event.published", "event", str(event.id))
    await session.commit()
    return event


@app.post("/v1/events/{event_id}/registrations", response_model=RegistrationRead, status_code=status.HTTP_201_CREATED)
async def register(event_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> Registration:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status != EventStatus.published:
        raise HTTPException(status_code=409, detail="Event is not open for registration")
    if not await session.scalar(select(Membership).where(Membership.club_id == event.club_id, Membership.user_id == actor.user_id)):
        raise HTTPException(status_code=403, detail="Join this club before registering")
    if await session.scalar(select(Registration).where(Registration.event_id == event_id, Registration.user_id == actor.user_id)):
        raise HTTPException(status_code=409, detail="Already registered")
    confirmed = await session.scalar(select(func.count()).select_from(Registration).where(Registration.event_id == event_id, Registration.status == RegistrationStatus.confirmed))
    waitlist_position = None
    registration_status = RegistrationStatus.confirmed
    if confirmed >= event.capacity:
        registration_status = RegistrationStatus.waitlisted
        waitlist_position = int(await session.scalar(select(func.count()).select_from(Registration).where(Registration.event_id == event_id, Registration.status == RegistrationStatus.waitlisted))) + 1
    registration = Registration(club_id=event.club_id, event_id=event.id, user_id=actor.user_id, status=registration_status, waitlist_position=waitlist_position)
    session.add(registration)
    await session.flush()
    await audit(session, event.club_id, actor.user_id, "registration.created", "registration", str(registration.id))
    await session.commit()
    return registration


@app.post("/v1/events/{event_id}/divisions", response_model=DivisionRead, status_code=status.HTTP_201_CREATED)
async def create_division(
    event_id: UUID,
    payload: DivisionCreate,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> Division:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    await require_role(session, event.club_id, actor.user_id, {MembershipRole.owner, MembershipRole.admin, MembershipRole.organizer})
    division = Division(club_id=event.club_id, event_id=event.id, **payload.model_dump())
    session.add(division)
    await session.flush()
    await audit(session, event.club_id, actor.user_id, "division.created", "division", str(division.id))
    await session.commit()
    return division


@app.get("/v1/clubs/{club_id}/divisions", response_model=list[DivisionRead])
async def list_divisions(
    club_id: UUID,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> list[Division]:
    await require_role(session, club_id, actor.user_id, set(MembershipRole))
    return list((await session.scalars(select(Division).where(Division.club_id == club_id).order_by(Division.name))).all())


@app.post("/v1/clubs/{club_id}/teams", response_model=TeamRead, status_code=status.HTTP_201_CREATED)
async def create_triace_team(
    club_id: UUID,
    payload: TeamCreate,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> Team:
    if len({member.user_id for member in payload.members}) != 3:
        raise HTTPException(status_code=422, detail="TRIACE teams require three distinct players")
    division = await session.get(Division, payload.division_id)
    if division is None or division.club_id != club_id:
        raise HTTPException(status_code=404, detail="Division not found for this club")
    for member in payload.members:
        if not await session.scalar(select(Membership).where(Membership.club_id == club_id, Membership.user_id == member.user_id)):
            raise HTTPException(status_code=422, detail=f"{member.user_id} is not a club member")
    if actor.user_id not in {member.user_id for member in payload.members}:
        await require_role(session, club_id, actor.user_id, {MembershipRole.owner, MembershipRole.admin, MembershipRole.organizer})
    total_rating = round(sum(member.rating for member in payload.members), 2)
    minimum = division.rules.get("teamMinRating")
    maximum = division.rules.get("teamMaxRating")
    if minimum is not None and total_rating < float(minimum):
        raise HTTPException(status_code=422, detail=f"Combined rating must be at least {minimum}")
    if maximum is not None and total_rating > float(maximum):
        raise HTTPException(status_code=422, detail=f"Combined rating cannot exceed {maximum}")
    team = Team(
        club_id=club_id,
        division_id=division.id,
        name=payload.name,
        captain_user_id=actor.user_id,
        status=TeamStatus.pending,
        metadata_={"combinedRating": total_rating},
    )
    session.add(team)
    await session.flush()
    for member in payload.members:
        session.add(TeamMember(club_id=club_id, team_id=team.id, **member.model_dump()))
    await audit(session, club_id, actor.user_id, "triace.team.created", "team", str(team.id))
    await session.commit()
    return team


@app.get("/v1/clubs/{club_id}/teams", response_model=list[TeamRead])
async def list_teams(
    club_id: UUID,
    division_id: UUID | None = None,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> list[Team]:
    await require_role(session, club_id, actor.user_id, set(MembershipRole))
    statement = select(Team).where(Team.club_id == club_id)
    if division_id:
        statement = statement.where(Team.division_id == division_id)
    return list((await session.scalars(statement.order_by(Team.name))).all())


@app.post("/v1/clubs/{club_id}/fixtures", response_model=FixtureRead, status_code=status.HTTP_201_CREATED)
async def create_fixture(
    club_id: UUID,
    payload: FixtureCreate,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> Fixture:
    await require_role(session, club_id, actor.user_id, {MembershipRole.owner, MembershipRole.admin, MembershipRole.organizer})
    division = await session.get(Division, payload.division_id)
    teams = [await session.get(Team, team_id) for team_id in (payload.home_team_id, payload.away_team_id)]
    if division is None or division.club_id != club_id or any(team is None or team.club_id != club_id or team.division_id != division.id for team in teams):
        raise HTTPException(status_code=422, detail="Fixture teams must belong to the selected club and division")
    if payload.home_team_id == payload.away_team_id:
        raise HTTPException(status_code=422, detail="A team cannot play itself")
    fixture = Fixture(club_id=club_id, **payload.model_dump())
    session.add(fixture)
    await session.flush()
    await audit(session, club_id, actor.user_id, "fixture.created", "fixture", str(fixture.id))
    await session.commit()
    return fixture


@app.post("/v1/fixtures/{fixture_id}/result", response_model=FixtureRead)
async def record_fixture_result(
    fixture_id: UUID,
    payload: FixtureResult,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> Fixture:
    fixture = await session.get(Fixture, fixture_id)
    if fixture is None:
        raise HTTPException(status_code=404, detail="Fixture not found")
    await require_role(session, fixture.club_id, actor.user_id, {MembershipRole.owner, MembershipRole.admin, MembershipRole.organizer})
    if payload.score_home == payload.score_away:
        raise HTTPException(status_code=422, detail="TRIACE fixture results cannot end in a tie")
    fixture.score_home = payload.score_home
    fixture.score_away = payload.score_away
    fixture.winner_team_id = fixture.home_team_id if payload.score_home > payload.score_away else fixture.away_team_id
    fixture.status = FixtureStatus.finalized
    await rebuild_team_standings(session, fixture.club_id, fixture.division_id)
    await audit(session, fixture.club_id, actor.user_id, "fixture.finalized", "fixture", str(fixture.id))
    await session.commit()
    return fixture
