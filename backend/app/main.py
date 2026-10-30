from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .database import engine, get_session
from .auth import Actor, current_actor
from .models import AuditLog, Base, Club, Event, EventStatus, Membership, MembershipRole, Registration, RegistrationStatus
from .schemas import ClubCreate, ClubRead, EventCreate, EventRead, MembershipCreate, MembershipRead, RegistrationRead


async def audit(session: AsyncSession, club_id: UUID, actor: str, action: str, entity_type: str, entity_id: str) -> None:
    session.add(AuditLog(club_id=club_id, actor_id=actor, action=action, entity_type=entity_type, entity_id=entity_id))


async def require_role(session: AsyncSession, club_id: UUID, actor: str, roles: set[MembershipRole]) -> Membership:
    membership = await session.scalar(select(Membership).where(Membership.club_id == club_id, Membership.user_id == actor))
    if membership is None or membership.role not in roles:
        raise HTTPException(status_code=403, detail="Club role is not permitted")
    return membership


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
