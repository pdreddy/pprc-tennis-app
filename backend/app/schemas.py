from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .models import EventStatus, MembershipRole, RegistrationStatus


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
