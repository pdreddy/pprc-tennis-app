from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .models import EventStatus, FixtureStatus, MembershipRole, RegistrationStatus, TeamStatus


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ClubCreate(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9-]{3,80}$")
    name: str = Field(min_length=2, max_length=160)
    sport: str = Field(default="tennis", max_length=40)


class ClubRead(ORMModel):
    id: UUID
    slug: str
    name: str
    sport: str


class MembershipCreate(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    display_name: str = Field(min_length=1, max_length=160)
    role: MembershipRole = MembershipRole.player


class MembershipRead(ORMModel):
    id: UUID
    club_id: UUID
    user_id: str
    display_name: str
    role: MembershipRole


class EventCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    starts_at: datetime
    capacity: int = Field(default=32, ge=2, le=5000)
    entry_fee_cents: int = Field(default=0, ge=0)
    rules: dict = Field(default_factory=dict)


class EventRead(ORMModel):
    id: UUID
    club_id: UUID
    name: str
    starts_at: datetime
    capacity: int
    entry_fee_cents: int
    status: EventStatus
    rules: dict


class RegistrationRead(ORMModel):
    id: UUID
    club_id: UUID
    event_id: UUID
    user_id: str
    status: RegistrationStatus
    waitlist_position: int | None


class DivisionCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    format: str = Field(default="round_robin", max_length=48)
    capacity: int = Field(default=32, ge=2, le=5000)
    min_rating: float | None = Field(default=None, ge=0, le=20)
    max_rating: float | None = Field(default=None, ge=0, le=20)
    rules: dict = Field(default_factory=dict)


class DivisionRead(ORMModel):
    id: UUID
    club_id: UUID
    event_id: UUID | None
    name: str
    format: str
    capacity: int
    rules: dict


class TeamMemberInput(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    rating: float = Field(ge=0, le=20)
    lineup_position: int = Field(ge=1, le=3)


class TeamCreate(BaseModel):
    division_id: UUID
    name: str = Field(min_length=2, max_length=160)
    members: list[TeamMemberInput] = Field(min_length=3, max_length=3)


class TeamRead(ORMModel):
    id: UUID
    club_id: UUID
    division_id: UUID | None
    name: str
    captain_user_id: str
    status: TeamStatus


class FixtureCreate(BaseModel):
    division_id: UUID
    home_team_id: UUID
    away_team_id: UUID
    starts_at: datetime


class FixtureResult(BaseModel):
    score_home: int = Field(ge=0, le=99)
    score_away: int = Field(ge=0, le=99)


class FixtureRead(ORMModel):
    id: UUID
    club_id: UUID
    division_id: UUID
    home_team_id: UUID
    away_team_id: UUID
    starts_at: datetime
    score_home: int | None
    score_away: int | None
    winner_team_id: UUID | None
    status: FixtureStatus
