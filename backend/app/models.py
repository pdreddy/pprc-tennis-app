import enum
import uuid
from datetime import datetime

from datetime import timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, TypeDecorator, UniqueConstraint, Uuid, func
from sqlalchemy.dialects import postgresql

# Portable column types: native JSONB/UUID on PostgreSQL, JSON/CHAR on SQLite (preview).
JSONB = JSON().with_variant(postgresql.JSONB(), "postgresql")
UUID = Uuid


class UTCDateTime(TypeDecorator):
    """Timezone-aware UTC datetimes on every backend (SQLite drops tzinfo)."""
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class MembershipRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    organizer = "organizer"
    player = "player"
    support = "support"


class EventStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    closed = "closed"
    completed = "completed"


class RegistrationStatus(str, enum.Enum):
    pending = "pending"
    confirmed = "confirmed"
    waitlisted = "waitlisted"
    withdrawn = "withdrawn"


class TeamStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class FixtureStatus(str, enum.Enum):
    scheduled = "scheduled"
    reported = "reported"
    finalized = "finalized"


class Timestamped:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), server_default=func.now(), onupdate=func.now()
    )


class Club(Timestamped, Base):
    __tablename__ = "clubs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    sport: Mapped[str] = mapped_column(String(40), default="tennis")


class Membership(Timestamped, Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("club_id", "user_id", name="uq_membership_club_user"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    display_name: Mapped[str] = mapped_column(String(160))
    role: Mapped[MembershipRole] = mapped_column(Enum(MembershipRole), default=MembershipRole.player)


class Event(Timestamped, Base):
    __tablename__ = "events"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    capacity: Mapped[int] = mapped_column(Integer, default=32)
    entry_fee_cents: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[EventStatus] = mapped_column(Enum(EventStatus), default=EventStatus.draft)
    rules: Mapped[dict] = mapped_column(JSONB, default=dict)


class Registration(Timestamped, Base):
    __tablename__ = "registrations"
    __table_args__ = (UniqueConstraint("event_id", "user_id", name="uq_registration_event_user"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    status: Mapped[RegistrationStatus] = mapped_column(Enum(RegistrationStatus))
    waitlist_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checked_in_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)


class Match(Timestamped, Base):
    __tablename__ = "matches"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    player_one_id: Mapped[str] = mapped_column(String(128))
    player_two_id: Mapped[str] = mapped_column(String(128))
    score: Mapped[str | None] = mapped_column(String(120), nullable=True)
    winner_id: Mapped[str | None] = mapped_column(String(128), nullable=True)


class Payment(Timestamped, Base):
    __tablename__ = "payments"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    registration_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("registrations.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(String(32), default="stripe")
    provider_reference: Mapped[str] = mapped_column(String(160), unique=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="pending")


class Season(Timestamped, Base):
    __tablename__ = "seasons"
    __table_args__ = (UniqueConstraint("club_id", "name", name="uq_season_club_name"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    starts_on: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    ends_on: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="draft")


class Division(Base):
    __tablename__ = "divisions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    format: Mapped[str] = mapped_column(String(48))
    min_rating: Mapped[float | None] = mapped_column(Numeric(4, 2), nullable=True)
    max_rating: Mapped[float | None] = mapped_column(Numeric(4, 2), nullable=True)
    capacity: Mapped[int] = mapped_column(Integer, default=32)
    rules: Mapped[dict] = mapped_column(JSONB, default=dict)


class Team(Timestamped, Base):
    __tablename__ = "teams"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    season_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("seasons.id", ondelete="SET NULL"), nullable=True)
    division_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("divisions.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    captain_user_id: Mapped[str] = mapped_column(String(128))
    status: Mapped[TeamStatus] = mapped_column(Enum(TeamStatus), default=TeamStatus.pending)
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_team_member"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(128))
    lineup_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rating: Mapped[float | None] = mapped_column(Numeric(4, 2), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Fixture(Timestamped, Base):
    __tablename__ = "fixtures"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    division_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("divisions.id", ondelete="CASCADE"), index=True)
    home_team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    away_team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    starts_at: Mapped[datetime] = mapped_column(UTCDateTime())
    score_home: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score_away: Mapped[int | None] = mapped_column(Integer, nullable=True)
    winner_team_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[FixtureStatus] = mapped_column(Enum(FixtureStatus), default=FixtureStatus.scheduled)
    result_detail: Mapped[dict] = mapped_column(JSONB, default=dict)
    round_name: Mapped[str] = mapped_column(String(64), default="regular")
    bracket_position: Mapped[int | None] = mapped_column(Integer, nullable=True)


class PlayerAppearance(Base):
    __tablename__ = "player_appearances"
    __table_args__ = (UniqueConstraint("fixture_id", "user_id", name="uq_fixture_player_appearance"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    division_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("divisions.id", ondelete="CASCADE"), index=True)
    fixture_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("fixtures.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    singles_played: Mapped[bool] = mapped_column(Boolean, default=True)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    kind: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(180))
    body: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSONB, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())


class Standing(Base):
    __tablename__ = "standings"
    __table_args__ = (UniqueConstraint("event_id", "division_id", "subject_type", "subject_id", name="uq_standing_subject"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=True)
    division_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("divisions.id", ondelete="CASCADE"), nullable=True)
    subject_type: Mapped[str] = mapped_column(String(16))
    subject_id: Mapped[str] = mapped_column(String(128))
    played: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)
    points: Mapped[int] = mapped_column(Integer, default=0)
    tiebreak: Mapped[dict] = mapped_column(JSONB, default=dict)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[str] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str] = mapped_column(String(128))
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())


class DivisionEntry(Base):
    """An individual (singles) competitor in an individual-format division."""
    __tablename__ = "division_entries"
    __table_args__ = (UniqueConstraint("division_id", "user_id", name="uq_division_entry_user"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    division_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("divisions.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    display_name: Mapped[str] = mapped_column(String(160))
    seed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rating: Mapped[float | None] = mapped_column(Numeric(4, 2), nullable=True)
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)  # ladder position, 1 = top
    partner_user_id: Mapped[str | None] = mapped_column(String(128), nullable=True)  # doubles partner
    partner_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    group_label: Mapped[str | None] = mapped_column(String(8), nullable=True)  # groups + knockout
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | withdrawn
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())


class CompetitionMatch(Base):
    """A singles match in a round robin, elimination bracket or ladder challenge."""
    __tablename__ = "competition_matches"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    division_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("divisions.id", ondelete="CASCADE"), index=True)
    round_number: Mapped[int] = mapped_column(Integer, default=1)
    round_name: Mapped[str] = mapped_column(String(64), default="regular")
    position: Mapped[int] = mapped_column(Integer, default=0)
    player_one_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    player_two_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    winner_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    score_one: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score_two: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score_text: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | scheduled | reported | finalized | bye
    reported_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    next_match_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("competition_matches.id", ondelete="SET NULL"), nullable=True)
    next_slot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    loser_match_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("competition_matches.id", ondelete="SET NULL"), nullable=True)
    loser_slot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())


class PlayerProfile(Timestamped, Base):
    """Club-scoped player profile. Visibility: public (anyone), club (members), private (self + staff)."""
    __tablename__ = "player_profiles"
    __table_args__ = (UniqueConstraint("club_id", "user_id", name="uq_player_profile_club_user"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    display_name: Mapped[str] = mapped_column(String(160))
    city: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    state: Mapped[str | None] = mapped_column(String(60), nullable=True)
    home_club: Mapped[str | None] = mapped_column(String(160), nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    preferred_sport: Mapped[str] = mapped_column(String(40), default="tennis")
    age_group: Mapped[str | None] = mapped_column(String(40), nullable=True)
    gender_category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    visibility: Mapped[str] = mapped_column(String(16), default="club")
    starting_singles: Mapped[float] = mapped_column(Numeric(5, 2), default=5)
    starting_doubles: Mapped[float] = mapped_column(Numeric(5, 2), default=5)


class PlayerRating(Base):
    """Current PPRC Rating per player and kind (singles/doubles); rebuilt by replay."""
    __tablename__ = "player_ratings"
    __table_args__ = (UniqueConstraint("club_id", "user_id", "kind", name="uq_player_rating"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    rating: Mapped[float] = mapped_column(Numeric(6, 4), index=True)
    reliability: Mapped[float] = mapped_column(Numeric(5, 1), default=0)
    verified_matches: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)
    provisional: Mapped[bool] = mapped_column(Boolean, default=True)
    last_played_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    formula_version: Mapped[str] = mapped_column(String(32))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now(), onupdate=func.now())


class RatedMatch(Timestamped, Base):
    """A singles/doubles result that may feed PPRC Rating once finalized."""
    __tablename__ = "rated_matches"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(16), default="reported")  # reported | competition
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    division_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("divisions.id", ondelete="SET NULL"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(16))
    side_one: Mapped[list] = mapped_column(JSONB, default=list)
    side_two: Mapped[list] = mapped_column(JSONB, default=list)
    score_text: Mapped[str | None] = mapped_column(String(120), nullable=True)
    games_one: Mapped[int | None] = mapped_column(Integer, nullable=True)
    games_two: Mapped[int | None] = mapped_column(Integer, nullable=True)
    winner_side: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outcome: Mapped[str] = mapped_column(String(16), default="completed")
    match_format: Mapped[str] = mapped_column(String(16), default="best_of_3")
    played_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    status: Mapped[str] = mapped_column(String(16), default="reported", index=True)  # reported | finalized | disputed | cancelled
    rated: Mapped[bool] = mapped_column(Boolean, default=False)
    reported_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    confirmed_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    dispute_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    correction_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class RatingHistory(Base):
    __tablename__ = "rating_history"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    rated_match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rated_matches.id", ondelete="CASCADE"))
    rating_before: Mapped[float] = mapped_column(Numeric(6, 4))
    rating_after: Mapped[float] = mapped_column(Numeric(6, 4))
    played_at: Mapped[datetime] = mapped_column(UTCDateTime(), index=True)
    formula_version: Mapped[str] = mapped_column(String(32))


class PlayerPreference(Base):
    """Per-player notification settings and delivery bookkeeping (kept apart from the public profile)."""
    __tablename__ = "player_preferences"
    __table_args__ = (UniqueConstraint("club_id", "user_id", name="uq_player_preference"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    weekly_recap: Mapped[bool] = mapped_column(Boolean, default=False)
    recap_sent_week: Mapped[str | None] = mapped_column(String(10), nullable=True)
    milestones_notified: Mapped[list] = mapped_column(JSONB, default=list)
    last_self_recap_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
