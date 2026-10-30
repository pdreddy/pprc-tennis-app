"""Helpers shared by the API routers."""
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuditLog, Membership, MembershipRole, Notification

STAFF_ROLES = {MembershipRole.owner, MembershipRole.admin, MembershipRole.organizer}


async def audit(
    session: AsyncSession,
    club_id: UUID,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: str,
    detail: str | None = None,
) -> None:
    session.add(AuditLog(club_id=club_id, actor_id=actor, action=action, entity_type=entity_type, entity_id=entity_id, detail=detail))


async def notify(session: AsyncSession, club_id: UUID, user_id: str, kind: str, title: str, body: str, data: dict | None = None) -> None:
    session.add(Notification(club_id=club_id, user_id=user_id, kind=kind, title=title, body=body, data=data or {}))


async def require_role(session: AsyncSession, club_id: UUID, actor: str, roles: set[MembershipRole]) -> Membership:
    membership = await session.scalar(select(Membership).where(Membership.club_id == club_id, Membership.user_id == actor))
    if membership is None or membership.role not in roles:
        raise HTTPException(status_code=403, detail="Club role is not permitted")
    return membership
