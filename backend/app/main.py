from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from math import ceil
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, status
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
    PlayerAppearance,
    Payment,
    Notification,
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
    TeamEligibilityRead,
    PlayoffSeedRead,
    PlayoffGenerate,
    ChampionRead,
    CheckoutRead,
    NotificationRead,
)


async def audit(session: AsyncSession, club_id: UUID, actor: str, action: str, entity_type: str, entity_id: str) -> None:
    session.add(AuditLog(club_id=club_id, actor_id=actor, action=action, entity_type=entity_type, entity_id=entity_id))


async def notify(session: AsyncSession, club_id: UUID, user_id: str, kind: str, title: str, body: str, data: dict | None = None) -> None:
    session.add(Notification(club_id=club_id, user_id=user_id, kind=kind, title=title, body=body, data=data or {}))


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


async def team_eligibility(session: AsyncSession, team: Team) -> TeamEligibilityRead:
    """TRIACE rule: every active team member must play singles on the configured share of team match days."""
    if team.division_id is None:
        return TeamEligibilityRead(team_id=team.id, eligible=False, required_singles_days=0, player_singles_days={}, missing_player_ids=[])
    division = await session.get(Division, team.division_id)
    threshold = float((division.rules if division else {}).get("minSinglesParticipationPct", 0.4))
    fixtures = list(
        (
            await session.scalars(
                select(Fixture).where(
                    Fixture.division_id == team.division_id,
                    Fixture.status == FixtureStatus.finalized,
                    (Fixture.home_team_id == team.id) | (Fixture.away_team_id == team.id),
                )
            )
        ).all()
    )
    required = ceil(len({fixture.starts_at.date() for fixture in fixtures}) * threshold)
    members = list((await session.scalars(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.active.is_(True)))).all())
    appearances = list(
        (
            await session.scalars(
                select(PlayerAppearance).where(
                    PlayerAppearance.team_id == team.id,
                    PlayerAppearance.singles_played.is_(True),
                )
            )
        ).all()
    )
    fixture_ids = {fixture.id: fixture.starts_at.date() for fixture in fixtures}
    days: dict[str, set] = {member.user_id: set() for member in members}
    for appearance in appearances:
        match_day = fixture_ids.get(appearance.fixture_id)
        if match_day:
            days.setdefault(appearance.user_id, set()).add(match_day)
    totals = {user_id: len(value) for user_id, value in days.items()}
    missing = [member.user_id for member in members if totals.get(member.user_id, 0) < required]
    return TeamEligibilityRead(
        team_id=team.id,
        eligible=bool(members) and bool(fixtures) and not missing,
        required_singles_days=required,
        player_singles_days=totals,
        missing_player_ids=missing,
    )


async def ranked_playoff_teams(session: AsyncSession, division: Division) -> list[tuple[Team, Standing | None, TeamEligibilityRead]]:
    teams = list((await session.scalars(select(Team).where(Team.division_id == division.id, Team.status == TeamStatus.approved))).all())
    standing_rows = list((await session.scalars(select(Standing).where(Standing.division_id == division.id, Standing.subject_type == "team"))).all())
    standings = {row.subject_id: row for row in standing_rows}
    ranked = [(team, standings.get(str(team.id)), await team_eligibility(session, team)) for team in teams]
    ranked.sort(key=lambda item: (not item[2].eligible, -(item[1].points if item[1] else 0), -(item[1].wins if item[1] else 0), item[0].name.lower()))
    return ranked


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
    await notify(session, event.club_id, actor.user_id, "registration", "Registration received", f"You are {registration.status.value} for {event.name}.", {"eventId": str(event.id), "registrationId": str(registration.id)})
    await session.commit()
    return registration


@app.get("/v1/notifications", response_model=list[NotificationRead])
async def list_notifications(
    unread_only: bool = False,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> list[Notification]:
    statement = select(Notification).where(Notification.user_id == actor.user_id)
    if unread_only:
        statement = statement.where(Notification.read_at.is_(None))
    return list((await session.scalars(statement.order_by(Notification.created_at.desc()))).all())


@app.post("/v1/notifications/{notification_id}/read", response_model=NotificationRead)
async def mark_notification_read(
    notification_id: UUID,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> Notification:
    item = await session.get(Notification, notification_id)
    if item is None or item.user_id != actor.user_id:
        raise HTTPException(status_code=404, detail="Notification not found")
    item.read_at = datetime.now(timezone.utc)
    await session.commit()
    return item


@app.post("/v1/registrations/{registration_id}/checkout", response_model=CheckoutRead)
async def start_checkout(
    registration_id: UUID,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> CheckoutRead:
    registration = await session.get(Registration, registration_id)
    if registration is None or registration.user_id != actor.user_id:
        raise HTTPException(status_code=404, detail="Registration not found")
    event = await session.get(Event, registration.event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    existing = await session.scalar(
        select(Payment)
        .where(Payment.registration_id == registration.id, Payment.status.in_(["pending", "paid"]))
        .order_by(Payment.created_at.desc())
    )
    if existing and existing.status == "paid":
        return CheckoutRead(payment_id=existing.id, status="paid", development=existing.provider == "development")
    settings = get_settings()
    if not settings.stripe_secret_key:
        if not settings.allow_development_header:
            raise HTTPException(status_code=503, detail="Stripe Checkout is not configured")
        payment = existing or Payment(
            club_id=event.club_id,
            registration_id=registration.id,
            provider="development",
            provider_reference=f"dev_{uuid4().hex}",
            amount_cents=event.entry_fee_cents,
            status="pending",
        )
        if not existing:
            session.add(payment)
            await session.flush()
            await session.commit()
        return CheckoutRead(payment_id=payment.id, status=payment.status, development=True)
    try:
        import stripe

        stripe.api_key = settings.stripe_secret_key
        payment = existing or Payment(
            club_id=event.club_id,
            registration_id=registration.id,
            provider="stripe",
            provider_reference=f"pending_{uuid4().hex}",
            amount_cents=event.entry_fee_cents,
            status="pending",
        )
        if not existing:
            session.add(payment)
            await session.flush()
        checkout = stripe.checkout.Session.create(
            mode="payment",
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "product_data": {"name": event.name},
                        "unit_amount": event.entry_fee_cents,
                    },
                    "quantity": 1,
                }
            ],
            success_url=f"{settings.pprc_app_origin}/my-events?payment=success",
            cancel_url=f"{settings.pprc_app_origin}/my-events?payment=cancelled",
            metadata={"payment_id": str(payment.id), "registration_id": str(registration.id), "user_id": actor.user_id},
        )
        payment.provider_reference = checkout.id
        await session.commit()
        return CheckoutRead(payment_id=payment.id, status=payment.status, development=False, checkout_url=checkout.url)
    except Exception as exc:
        await session.rollback()
        raise HTTPException(status_code=502, detail="Unable to start Stripe Checkout") from exc


@app.post("/v1/payments/{payment_id}/confirm-development", response_model=CheckoutRead)
async def confirm_development_payment(
    payment_id: UUID,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> CheckoutRead:
    if not get_settings().allow_development_header:
        raise HTTPException(status_code=404, detail="Not found")
    payment = await session.get(Payment, payment_id)
    if payment is None or payment.provider != "development":
        raise HTTPException(status_code=404, detail="Development payment not found")
    registration = await session.get(Registration, payment.registration_id)
    if registration is None or registration.user_id != actor.user_id:
        raise HTTPException(status_code=403, detail="Payment is not owned by this user")
    payment.status = "paid"
    registration.status = RegistrationStatus.confirmed
    await audit(session, payment.club_id, actor.user_id, "payment.development_confirmed", "payment", str(payment.id))
    await session.commit()
    return CheckoutRead(payment_id=payment.id, status="paid", development=True)


@app.post("/v1/webhooks/stripe", status_code=status.HTTP_204_NO_CONTENT)
async def stripe_webhook(request: Request, session: AsyncSession = Depends(get_session)) -> None:
    settings = get_settings()
    if not settings.stripe_secret_key or not settings.stripe_webhook_secret:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        import stripe

        event = stripe.Webhook.construct_event(
            await request.body(),
            request.headers.get("stripe-signature"),
            settings.stripe_webhook_secret,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook") from exc
    if event["type"] not in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
        return
    checkout = event["data"]["object"]
    payment_id = checkout.get("metadata", {}).get("payment_id")
    if not payment_id:
        return
    payment = await session.get(Payment, UUID(payment_id))
    if payment is None or payment.provider_reference != checkout["id"]:
        raise HTTPException(status_code=400, detail="Payment reconciliation failed")
    if payment.status != "paid":
        payment.status = "paid"
        registration = await session.get(Registration, payment.registration_id)
        if registration:
            registration.status = RegistrationStatus.confirmed
        await audit(session, payment.club_id, "stripe", "payment.paid", "payment", str(payment.id))
        await session.commit()


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
    for team in teams:
        await notify(session, club_id, team.captain_user_id, "fixture", "Match scheduled", f"{team.name} has a scheduled TRIACE fixture.", {"fixtureId": str(fixture.id)})
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
    home_members = set((await session.scalars(select(TeamMember.user_id).where(TeamMember.team_id == fixture.home_team_id, TeamMember.active.is_(True)))).all())
    away_members = set((await session.scalars(select(TeamMember.user_id).where(TeamMember.team_id == fixture.away_team_id, TeamMember.active.is_(True)))).all())
    home_players, away_players = set(payload.home_singles_player_ids), set(payload.away_singles_player_ids)
    if len(home_players) != len(payload.home_singles_player_ids) or len(away_players) != len(payload.away_singles_player_ids):
        raise HTTPException(status_code=422, detail="A player can appear only once per team fixture")
    if not home_players.issubset(home_members) or not away_players.issubset(away_members):
        raise HTTPException(status_code=422, detail="Singles players must be active members of their assigned team")
    fixture.score_home = payload.score_home
    fixture.score_away = payload.score_away
    fixture.winner_team_id = fixture.home_team_id if payload.score_home > payload.score_away else fixture.away_team_id
    fixture.status = FixtureStatus.finalized
    await session.execute(PlayerAppearance.__table__.delete().where(PlayerAppearance.fixture_id == fixture.id))
    for team_id, player_ids in ((fixture.home_team_id, home_players), (fixture.away_team_id, away_players)):
        for user_id in player_ids:
            session.add(PlayerAppearance(club_id=fixture.club_id, division_id=fixture.division_id, fixture_id=fixture.id, team_id=team_id, user_id=user_id))
    await rebuild_team_standings(session, fixture.club_id, fixture.division_id)
    if fixture.round_name == "playoff_semifinal":
        semifinals = list(
            (
                await session.scalars(
                    select(Fixture).where(
                        Fixture.division_id == fixture.division_id,
                        Fixture.round_name == "playoff_semifinal",
                    ).order_by(Fixture.bracket_position)
                )
            ).all()
        )
        final_exists = await session.scalar(
            select(Fixture).where(Fixture.division_id == fixture.division_id, Fixture.round_name == "playoff_final")
        )
        if len(semifinals) == 2 and all(item.status == FixtureStatus.finalized and item.winner_team_id for item in semifinals) and final_exists is None:
            session.add(
                Fixture(
                    club_id=fixture.club_id,
                    division_id=fixture.division_id,
                    home_team_id=semifinals[0].winner_team_id,
                    away_team_id=semifinals[1].winner_team_id,
                    starts_at=max(item.starts_at for item in semifinals) + timedelta(days=7),
                    round_name="playoff_final",
                    bracket_position=3,
                )
            )
    await audit(session, fixture.club_id, actor.user_id, "fixture.finalized", "fixture", str(fixture.id))
    await session.commit()
    return fixture


@app.post("/v1/teams/{team_id}/approve", response_model=TeamRead)
async def approve_team(
    team_id: UUID,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> Team:
    team = await session.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    await require_role(session, team.club_id, actor.user_id, {MembershipRole.owner, MembershipRole.admin, MembershipRole.organizer})
    members = list((await session.scalars(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.active.is_(True)))).all())
    if len(members) != 3:
        raise HTTPException(status_code=422, detail="TRIACE approval requires exactly three active team members")
    team.status = TeamStatus.approved
    await audit(session, team.club_id, actor.user_id, "triace.team.approved", "team", str(team.id))
    await notify(session, team.club_id, team.captain_user_id, "triace", "Team approved", f"{team.name} is approved for competition.", {"teamId": str(team.id)})
    await session.commit()
    return team


@app.get("/v1/teams/{team_id}/eligibility", response_model=TeamEligibilityRead)
async def get_team_eligibility(
    team_id: UUID,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> TeamEligibilityRead:
    team = await session.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    await require_role(session, team.club_id, actor.user_id, set(MembershipRole))
    return await team_eligibility(session, team)


@app.get("/v1/divisions/{division_id}/playoff-seeds", response_model=list[PlayoffSeedRead])
async def list_playoff_seeds(
    division_id: UUID,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> list[PlayoffSeedRead]:
    division = await session.get(Division, division_id)
    if division is None:
        raise HTTPException(status_code=404, detail="Division not found")
    await require_role(session, division.club_id, actor.user_id, set(MembershipRole))
    ranked = await ranked_playoff_teams(session, division)
    return [
        PlayoffSeedRead(seed=index, team_id=team.id, team_name=team.name, points=standing.points if standing else 0, eligible=eligibility.eligible)
        for index, (team, standing, eligibility) in enumerate(ranked, start=1)
    ]


@app.post("/v1/divisions/{division_id}/playoffs/generate", response_model=list[FixtureRead], status_code=status.HTTP_201_CREATED)
async def generate_playoffs(
    division_id: UUID,
    payload: PlayoffGenerate,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> list[Fixture]:
    division = await session.get(Division, division_id)
    if division is None:
        raise HTTPException(status_code=404, detail="Division not found")
    await require_role(session, division.club_id, actor.user_id, {MembershipRole.owner, MembershipRole.admin, MembershipRole.organizer})
    if await session.scalar(select(Fixture).where(Fixture.division_id == division.id, Fixture.round_name.in_(["playoff_semifinal", "playoff_final"]))):
        raise HTTPException(status_code=409, detail="Playoff bracket already exists")
    eligible = [item for item in await ranked_playoff_teams(session, division) if item[2].eligible]
    if len(eligible) < payload.size:
        raise HTTPException(status_code=422, detail=f"Need {payload.size} eligible teams to generate this playoff bracket")
    seeds = [item[0] for item in eligible[: payload.size]]
    fixtures: list[Fixture] = []
    if payload.size == 2:
        fixtures.append(Fixture(club_id=division.club_id, division_id=division.id, home_team_id=seeds[0].id, away_team_id=seeds[1].id, starts_at=payload.final_starts_at or payload.starts_at, round_name="playoff_final", bracket_position=1))
    else:
        fixtures.extend(
            [
                Fixture(club_id=division.club_id, division_id=division.id, home_team_id=seeds[0].id, away_team_id=seeds[3].id, starts_at=payload.starts_at, round_name="playoff_semifinal", bracket_position=1),
                Fixture(club_id=division.club_id, division_id=division.id, home_team_id=seeds[1].id, away_team_id=seeds[2].id, starts_at=payload.starts_at, round_name="playoff_semifinal", bracket_position=2),
            ]
        )
    session.add_all(fixtures)
    await session.flush()
    await audit(session, division.club_id, actor.user_id, "triace.playoffs.generated", "division", str(division.id))
    await session.commit()
    return fixtures


@app.get("/v1/divisions/{division_id}/champion", response_model=ChampionRead)
async def division_champion(
    division_id: UUID,
    session: AsyncSession = Depends(get_session),
    actor: Actor = Depends(current_actor),
) -> ChampionRead:
    division = await session.get(Division, division_id)
    if division is None:
        raise HTTPException(status_code=404, detail="Division not found")
    await require_role(session, division.club_id, actor.user_id, set(MembershipRole))
    final = await session.scalar(select(Fixture).where(Fixture.division_id == division.id, Fixture.round_name == "playoff_final"))
    champion = await session.get(Team, final.winner_team_id) if final and final.status == FixtureStatus.finalized and final.winner_team_id else None
    return ChampionRead(division_id=division.id, champion_team_id=champion.id if champion else None, champion_team_name=champion.name if champion else None, final_fixture_id=final.id if final else None)
