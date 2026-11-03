import os

os.chdir("/app")


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:80])
        s = s.replace(a, b, 1)
    open(p, "w").write(s)


edit("backend/app/models.py", [
    ('''    loser_slot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())''', '''    loser_slot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deadline_warned_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), server_default=func.now())'''),
    ('''    message: Mapped[str | None] = mapped_column(String(280), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending''', '''    message: Mapped[str | None] = mapped_column(String(280), nullable=True)
    court: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending'''),
])
edit("backend/app/recaps.py", [
    ('''            from .competitions import expire_all_ladders

            async with SessionLocal() as session:
                expired = await expire_all_ladders(session)''', '''            from .competitions import expire_all_ladders
            from .ladder_alerts import warn_all_ladders

            async with SessionLocal() as session:
                if warned := await warn_all_ladders(session):
                    logger.info("ladder deadline warnings sent for %s match(es)", warned)
                expired = await expire_all_ladders(session)'''),
])
edit("backend/app/challenges.py", [
    ('''    proposed_at: datetime | None = None
    message: str | None = Field(default=None, max_length=280)


class RespondInput''', '''    proposed_at: datetime | None = None
    message: str | None = Field(default=None, max_length=280)
    court: str | None = Field(default=None, max_length=80)


class RespondInput'''),
    ('''class ProposeInput(BaseModel):
    proposed_at: datetime
    message: str | None = Field(default=None, max_length=280)''', '''class ProposeInput(BaseModel):
    proposed_at: datetime
    message: str | None = Field(default=None, max_length=280)
    court: str | None = Field(default=None, max_length=80)'''),
    ('''        "proposed_at": c.proposed_at, "message": c.message,''', '''        "proposed_at": c.proposed_at, "court": c.court, "message": c.message,'''),
    ('''message=(payload.message or "").strip() or None, status="pending",''', '''message=(payload.message or "").strip() or None, court=(payload.court or "").strip() or None, status="pending",'''),
    ('''    if payload.message and payload.message.strip():
        c.message = payload.message.strip()''', '''    if payload.message and payload.message.strip():
        c.message = payload.message.strip()
    if payload.court is not None:
        c.court = payload.court.strip() or None'''),
    ('''@router.get("/v1/clubs/{club_id}/head-to-head/{player_a}/{player_b}")''', '''@router.get("/v1/clubs/{club_id}/rivalries")
async def rivalries(club_id: UUID, kind: Literal["singles", "doubles"] = "singles", limit: int = Query(5, ge=1, le=20), session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Most-played, closest and one-sided player pairs (2+ rated meetings); private players are left out."""
    viewer = await require_member(session, club_id, actor.user_id)
    hidden = await hidden_for(session, club_id, actor.user_id, is_staff(viewer))
    names = await names_for(session, club_id)
    tally: dict[tuple[str, str], list[int]] = {}
    last: dict[tuple[str, str], datetime] = {}
    rows = (await session.scalars(select(RatedMatch).where(RatedMatch.club_id == club_id, RatedMatch.status == "finalized", RatedMatch.rated.is_(True), RatedMatch.kind == kind))).all()
    for m in rows:
        for one in m.side_one:
            for two in m.side_two:
                if one in hidden or two in hidden or one not in names or two not in names:
                    continue
                a, b = sorted((one, two))
                wins = tally.setdefault((a, b), [0, 0])
                wins[0 if (m.winner_side == 1) == (a in m.side_one) else 1] += 1
                last[(a, b)] = max(last.get((a, b), m.played_at), m.played_at)
    pairs = []
    for (a, b), (a_wins, b_wins) in tally.items():
        if a_wins + b_wins < 2:
            continue
        lead, trail = ((a, a_wins), (b, b_wins)) if a_wins >= b_wins else ((b, b_wins), (a, a_wins))
        pairs.append({"a": {"user_id": lead[0], "display_name": names[lead[0]]}, "b": {"user_id": trail[0], "display_name": names[trail[0]]}, "a_wins": lead[1], "b_wins": trail[1], "meetings": a_wins + b_wins, "last_played_at": last[(a, b)]})
    recent = lambda p: -p["last_played_at"].timestamp()  # noqa: E731
    return {
        "kind": kind,
        "most_played": sorted(pairs, key=lambda p: (-p["meetings"], recent(p)))[:limit],
        "closest": sorted([p for p in pairs if p["b_wins"] > 0], key=lambda p: (p["a_wins"] - p["b_wins"], -p["meetings"], recent(p)))[:limit],
        "one_sided": sorted([p for p in pairs if p["b_wins"] == 0], key=lambda p: (-p["meetings"], recent(p)))[:limit],
    }


@router.get("/v1/clubs/{club_id}/head-to-head/{player_a}/{player_b}")'''),
    ("from fastapi import APIRouter, Depends, HTTPException\n", "from fastapi import APIRouter, Depends, HTTPException, Query\n"),
])
open("backend/sql/014_ladder_warnings_courts.sql", "w").write("-- Day-before ladder deadline warnings and a free-text court on match challenges.\nalter table competition_matches add column if not exists deadline_warned_at timestamptz;\nalter table challenges add column if not exists court varchar(80);\n")
print("ok")
