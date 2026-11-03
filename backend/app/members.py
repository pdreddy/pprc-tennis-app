"""Club member roles (admin-managed) and the Fair Match Finder."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import Actor, current_actor
from .common import audit, notify
from .database import get_session
from .models import Membership, MembershipRole, PlayerProfile, RatedMatch
from .ratings import club_ratings, membership, require_member, visible

router = APIRouter()
ASSIGNABLE = {"player": MembershipRole.player, "organizer": MembershipRole.organizer, "admin": MembershipRole.admin}
ROLE_LABELS = {"player": "Player", "organizer": "Organizer", "admin": "Club admin", "owner": "Owner"}


class RoleInput(BaseModel):
    role: str


async def require_club_admin(session: AsyncSession, club_id: UUID, actor: Actor) -> Membership:
    member = await membership(session, club_id, actor.user_id)
    if member is None or member.role not in {MembershipRole.owner, MembershipRole.admin}:
        raise HTTPException(status_code=403, detail="Only club admins can manage roles")
    return member


@router.get("/v1/clubs/{club_id}/members")
async def list_members(club_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[dict]:
    await require_club_admin(session, club_id, actor)
    rows = (await session.scalars(select(Membership).where(Membership.club_id == club_id).order_by(Membership.display_name))).all()
    return [{"user_id": m.user_id, "display_name": m.display_name, "role": m.role.value, "role_label": ROLE_LABELS.get(m.role.value, m.role.value), "is_you": m.user_id == actor.user_id} for m in rows]


@router.patch("/v1/clubs/{club_id}/members/{user_id}")
async def set_member_role(club_id: UUID, user_id: str, payload: RoleInput, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    await require_club_admin(session, club_id, actor)
    if payload.role not in ASSIGNABLE:
        raise HTTPException(status_code=422, detail="Role must be player, organizer or admin")
    target = await membership(session, club_id, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if target.role == MembershipRole.owner:
        raise HTTPException(status_code=409, detail="The club owner's role cannot be changed")
    if user_id == actor.user_id:
        raise HTTPException(status_code=409, detail="Ask another admin to change your own role")
    before = target.role.value
    target.role = ASSIGNABLE[payload.role]
    if before != target.role.value:
        await audit(session, club_id, actor.user_id, "membership.role_changed", "membership", str(target.id), f"{before} -> {target.role.value}")
        await notify(session, club_id, user_id, "role", f"You are now {ROLE_LABELS[payload.role].lower()}", f"A club admin changed your PPRC role to {ROLE_LABELS[payload.role]}.", {"link": "/admin" if payload.role != "player" else "/me/rating"})
    await session.commit()
    return {"user_id": user_id, "role": target.role.value, "role_label": ROLE_LABELS[target.role.value]}


async def fair_matches(session: AsyncSession, club_id: UUID, user_id: str, kind: str, spread: float, limit: int, staff: bool = False) -> list[dict]:
    """Members whose PPRC Rating is within `spread` of yours, closest first; established ratings rank above provisional ones."""
    ratings = await club_ratings(session, club_id, kind)
    mine = next((r for r in ratings if r.user_id == user_id), None)
    if mine is None:
        return []
    profiles = {p.user_id: p for p in (await session.scalars(select(PlayerProfile).where(PlayerProfile.club_id == club_id))).all()}
    members = {m.user_id: m for m in (await session.scalars(select(Membership).where(Membership.club_id == club_id))).all()}
    played = [m for m in (await session.scalars(select(RatedMatch).where(RatedMatch.club_id == club_id, RatedMatch.status == "finalized", RatedMatch.kind == kind))).all() if user_id in m.side_one or user_id in m.side_two]
    me = float(mine.rating)
    rows = []
    for r in ratings:
        gap = float(r.rating) - me
        if r.user_id == user_id or r.user_id not in members or abs(gap) > spread or not visible(profiles.get(r.user_id), user_id, staff):
            continue
        meetings = [m for m in played if m.winner_side in (1, 2) and (r.user_id in m.side_one or r.user_id in m.side_two)]
        wins = sum(1 for m in meetings if m.winner_side and (m.winner_side == 1) == (user_id in m.side_one))
        p = profiles.get(r.user_id)
        rows.append({
            "user_id": r.user_id, "display_name": p.display_name if p else members[r.user_id].display_name, "city": p.city if p else None,
            "image_url": p.image_url if p else None, "rating": round(float(r.rating), 2), "gap": round(gap, 2), "provisional": r.provisional,
            "reliability": float(r.reliability), "head_to_head": {"wins": wins, "losses": len(meetings) - wins},
        })
    rows.sort(key=lambda x: (x["provisional"], abs(x["gap"]), x["display_name"]))
    return rows[:limit]


@router.get("/v1/clubs/{club_id}/players/me/opponents")
async def my_fair_matches(club_id: UUID, kind: str = Query("singles", pattern="^(singles|doubles)$"), spread: float = Query(0.5, ge=0.1, le=3), limit: int = Query(8, ge=1, le=30), session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> list[dict]:
    member = await require_member(session, club_id, actor.user_id)
    return await fair_matches(session, club_id, actor.user_id, kind, spread, limit, staff=member.role in {MembershipRole.owner, MembershipRole.admin, MembershipRole.organizer})
