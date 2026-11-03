import os

os.chdir("/app")


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:80])
        s = s.replace(a, b, 1)
    open(p, "w").write(s)


edit("backend/app/models.py", [
    ('''    sport: Mapped[str] = mapped_column(String(40), default="tennis")
''', '''    sport: Mapped[str] = mapped_column(String(40), default="tennis")
    challenge_expiry_days: Mapped[int] = mapped_column(Integer, default=7, server_default="7")
'''),
    ('''    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending | accepted | declined | cancelled | completed
''', '''    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending | accepted | declined | cancelled | completed | expired
    awaiting_id: Mapped[str | None] = mapped_column(String(128), nullable=True)  # whose turn it is while pending (time can go back and forth)
    last_action_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    reminded_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
'''),
])

edit("backend/app/challenges.py", [
    ("from datetime import datetime, timezone\n", "from datetime import datetime, timedelta, timezone\n"),
    ("from .models import Challenge, PlayerPreference,", "from .models import Challenge, Club, PlayerPreference,"),
    ("from .ratings import ResultInput,", "from .members import require_club_admin\nfrom .ratings import ResultInput,"),
    ('''class RespondInput(BaseModel):
    action: Literal["accept", "decline"]
''', '''class RespondInput(BaseModel):
    action: Literal["accept", "decline"]


class ProposeInput(BaseModel):
    proposed_at: datetime
    message: str | None = Field(default=None, max_length=280)


class SettingsInput(BaseModel):
    challenge_expiry_days: int = Field(ge=3, le=30)


REMIND_AFTER = timedelta(days=2)
'''),
    ('''def challenge_view(c: Challenge, me: str, names: dict[str, str], result_status: str | None) -> dict:
    other = c.opponent_id if c.challenger_id == me else c.challenger_id
    return {''', '''def challenge_view(c: Challenge, me: str, names: dict[str, str], result_status: str | None, expiry_days: int = 7) -> dict:
    other = c.opponent_id if c.challenger_id == me else c.challenger_id
    started = c.last_action_at or c.created_at
    return {
        "awaiting_you": c.status == "pending" and (c.awaiting_id or c.opponent_id) == me,
        "expires_at": started + timedelta(days=expiry_days) if c.status == "pending" and started else None,'''),
    ('''def challenge_email(challenger: str, rating: float | None, when: datetime | None, link: str) -> str:
    """Fixed template; the free-text note is never emailed (it stays in-app)."""''', '''def challenge_email(challenger: str, rating: float | None, when: datetime | None, link: str, reminder: bool = False) -> str:
    """Fixed template; the free-text note is never emailed (it stays in-app)."""'''),
    ('''f'<p style="margin:0;font-size:12px;letter-spacing:2px;color:#087f80">PPRC MATCH CHALLENGE</p>'
            f'<h1 style="margin:8px 0 12px;font-size:24px;color:#102c43">{escape(challenger)}{escape(rating_line)} challenged you to a singles match</h1>'
            f'{when_line}<p style="margin:0 0 20px;color:#26394a">You were matched as a fair opponent. Accept or decline in the PPRC app; once accepted, either of you can report the score.</p>\'''',
     '''f'<p style="margin:0;font-size:12px;letter-spacing:2px;color:#087f80">{"FRIENDLY REMINDER" if reminder else "PPRC MATCH CHALLENGE"}</p>'
            f'<h1 style="margin:8px 0 12px;font-size:24px;color:#102c43">{escape(challenger)}{escape(rating_line)} {"is still waiting to hear from you" if reminder else "challenged you to a singles match"}</h1>'
            f'{when_line}<p style="margin:0 0 20px;color:#26394a">{"No rush, but the challenge will expire soon. Accept, decline or suggest another time in the PPRC app." if reminder else "You were matched as a fair opponent. Accept, decline or suggest another time in the PPRC app; once accepted, either of you can report the score."}</p>\''''),
    ('''async def email_opponent(session: AsyncSession, c: Challenge, challenger_name: str) -> bool:
    prefs = await session.scalar(select(PlayerPreference).where(PlayerPreference.club_id == c.club_id, PlayerPreference.user_id == c.opponent_id))
    if prefs is None or not prefs.email:
        return False
    mine = next((r for r in await club_ratings(session, c.club_id, "singles") if r.user_id == c.challenger_id), None)
    link = f"{os.environ['PPRC_APP_ORIGIN'].rstrip('/')}/me/matches?challenge={c.id}"
    try:
        await send_email(to=prefs.email, subject=f"{challenger_name} challenged you on PPRC", html=challenge_email(challenger_name, float(mine.rating) if mine else None, c.proposed_at, link))''',
     '''async def email_opponent(session: AsyncSession, c: Challenge, challenger_name: str, reminder: bool = False) -> bool:
    """Emails whoever must answer next (the challenged player, or the challenger after a new time)."""
    to_id = c.awaiting_id or c.opponent_id
    from_id = c.challenger_id if to_id == c.opponent_id else c.opponent_id
    prefs = await session.scalar(select(PlayerPreference).where(PlayerPreference.club_id == c.club_id, PlayerPreference.user_id == to_id))
    if prefs is None or not prefs.email:
        return False
    mine = next((r for r in await club_ratings(session, c.club_id, "singles") if r.user_id == from_id), None)
    link = f"{os.environ['PPRC_APP_ORIGIN'].rstrip('/')}/me/matches?challenge={c.id}"
    subject = f"Reminder: {challenger_name} is waiting on your PPRC challenge" if reminder else f"{challenger_name} challenged you on PPRC"
    try:
        await send_email(to=prefs.email, subject=subject, html=challenge_email(challenger_name, float(mine.rating) if mine else None, c.proposed_at, link, reminder))'''),
    ('''async def respond_view(session: AsyncSession, c: Challenge, me: str) -> dict:
    result = await session.get(RatedMatch, c.result_id) if c.result_id else None
    return challenge_view(c, me, await names_for(session, c.club_id), result.status if result else None)''',
     '''async def expiry_days(session: AsyncSession, club_id: UUID) -> int:
    return (await session.scalar(select(Club.challenge_expiry_days).where(Club.id == club_id))) or 7


async def respond_view(session: AsyncSession, c: Challenge, me: str) -> dict:
    result = await session.get(RatedMatch, c.result_id) if c.result_id else None
    return challenge_view(c, me, await names_for(session, c.club_id), result.status if result else None, await expiry_days(session, c.club_id))'''),
    ('''message=(payload.message or "").strip() or None, status="pending")''', '''message=(payload.message or "").strip() or None, status="pending", awaiting_id=payload.opponent_id, last_action_at=datetime.now(timezone.utc))'''),
    ('''    names = await names_for(session, club_id)
    return [challenge_view(c, actor.user_id, names, results.get(c.result_id)) for c in rows]''', '''    names = await names_for(session, club_id)
    days = await expiry_days(session, club_id)
    return [challenge_view(c, actor.user_id, names, results.get(c.result_id), days) for c in rows]'''),
    ('''    if c.opponent_id != actor.user_id:
        raise HTTPException(status_code=403, detail="Only the challenged player can respond")
    if c.status != "pending":
        raise HTTPException(status_code=409, detail="This challenge has already been answered")
    c.status, c.responded_at = ("accepted" if payload.action == "accept" else "declined"), datetime.now(timezone.utc)
    me = (await names_for(session, c.club_id)).get(actor.user_id, "Your opponent")
    body = "Play the match, then either of you reports the score." if c.status == "accepted" else "Find another fair match in My matches."
    await notify(session, c.club_id, c.challenger_id, "challenge", f"{me} {c.status} your challenge", body,''', '''    if c.status != "pending":
        raise HTTPException(status_code=409, detail="This challenge has already been answered")
    if (c.awaiting_id or c.opponent_id) != actor.user_id:
        raise HTTPException(status_code=403, detail="Waiting for the other player to answer")
    c.status, c.responded_at = ("accepted" if payload.action == "accept" else "declined"), datetime.now(timezone.utc)
    c.awaiting_id = None
    me = (await names_for(session, c.club_id)).get(actor.user_id, "Your opponent")
    other = c.challenger_id if actor.user_id == c.opponent_id else c.opponent_id
    body = "Play the match, then either of you reports the score." if c.status == "accepted" else "Find another fair match in My matches."
    await notify(session, c.club_id, other, "challenge", f"{me} {c.status} {'your challenge' if other == c.challenger_id else 'the new time'}", body,'''),
    ('''@router.post("/v1/challenges/{challenge_id}/cancel")''', '''@router.post("/v1/challenges/{challenge_id}/propose")
async def propose_time(challenge_id: UUID, payload: ProposeInput, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Suggest a different time; the other player then accepts, declines or suggests again."""
    c = await load_challenge(session, challenge_id, actor)
    if c.status != "pending":
        raise HTTPException(status_code=409, detail="Only a pending challenge can get a new time")
    if (c.awaiting_id or c.opponent_id) != actor.user_id:
        raise HTTPException(status_code=403, detail="Waiting for the other player to answer")
    when = payload.proposed_at if payload.proposed_at.tzinfo else payload.proposed_at.replace(tzinfo=timezone.utc)
    if when < datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="Suggest a time in the future")
    other = c.challenger_id if actor.user_id == c.opponent_id else c.opponent_id
    c.proposed_at, c.awaiting_id, c.last_action_at, c.reminded_at = when, other, datetime.now(timezone.utc), None
    if payload.message and payload.message.strip():
        c.message = payload.message.strip()
    me = (await names_for(session, c.club_id)).get(actor.user_id, "Your opponent")
    await notify(session, c.club_id, other, "challenge", f"{me} suggested another time", "Accept the new time, decline, or suggest a different one.", {"challengeId": str(c.id), "link": f"/me/matches?challenge={c.id}"})
    await audit(session, c.club_id, actor.user_id, "challenge.time_proposed", "challenge", str(c.id))
    await session.commit()
    await email_opponent(session, c, me)
    return await respond_view(session, c, actor.user_id)


@router.post("/v1/challenges/{challenge_id}/cancel")'''),
    ('''    c.status = "cancelled"
    other =''', '''    c.status, c.awaiting_id = "cancelled", None
    other ='''),
    ('''@router.get("/v1/clubs/{club_id}/head-to-head/{player_a}/{player_b}")
async def head_to_head(club_id: UUID, player_a: str, player_b: str, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Every finalized meeting between two players, with each player's rating change in that match."""
    viewer = await require_member(session, club_id, actor.user_id)
    staff = is_staff(viewer)
    if player_a == player_b:
        raise HTTPException(status_code=422, detail="Choose two different players")
    names = await names_for(session, club_id)
    profiles = {p.user_id: p for p in (await session.scalars(select(PlayerProfile).where(PlayerProfile.club_id == club_id, PlayerProfile.user_id.in_([player_a, player_b])))).all()}
    for u in (player_a, player_b):
        if u not in names or not visible(profiles.get(u), actor.user_id, staff):
            raise HTTPException(status_code=404, detail="Player not available")
    hidden = await hidden_for(session, club_id, actor.user_id, staff)''', '''async def challenge_maintenance(session: AsyncSession, club_id: UUID, now: datetime | None = None) -> dict:
    """One gentle reminder after 2 quiet days; expire after the club's configured number of days."""
    now = now or datetime.now(timezone.utc)
    days = await expiry_days(session, club_id)
    names = await names_for(session, club_id)
    reminded = expired = 0
    for c in (await session.scalars(select(Challenge).where(Challenge.club_id == club_id, Challenge.status == "pending"))).all():
        started = c.last_action_at or c.created_at
        waiting = c.awaiting_id or c.opponent_id
        other = c.challenger_id if waiting == c.opponent_id else c.opponent_id
        if now - started >= timedelta(days=days):
            c.status, c.awaiting_id = "expired", None
            for u, title in ((other, "Your challenge expired"), (waiting, "A challenge expired")):
                await notify(session, club_id, u, "challenge", title, f"No answer within {days} days, so it was closed. Find another fair match in My matches.", {"challengeId": str(c.id), "link": "/me/matches"})
            expired += 1
            await session.commit()
        elif c.reminded_at is None and now - started >= REMIND_AFTER:
            c.reminded_at = now
            name = names.get(other, "A club member")
            await notify(session, club_id, waiting, "challenge", f"Reminder: {name} is waiting", "Accept, decline or suggest another time before the challenge expires.", {"challengeId": str(c.id), "link": f"/me/matches?challenge={c.id}"})
            await session.commit()  # stored before emailing so a restart never double-sends
            await email_opponent(session, c, name, reminder=True)
            reminded += 1
    return {"reminded": reminded, "expired": expired}


@router.get("/v1/clubs/{club_id}/challenge-settings")
async def get_challenge_settings(club_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    await require_member(session, club_id, actor.user_id)
    return {"challenge_expiry_days": await expiry_days(session, club_id), "reminder_after_days": REMIND_AFTER.days}


@router.put("/v1/clubs/{club_id}/challenge-settings")
async def save_challenge_settings(club_id: UUID, payload: SettingsInput, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    await require_club_admin(session, club_id, actor)
    club = await session.get(Club, club_id)
    club.challenge_expiry_days = payload.challenge_expiry_days
    await audit(session, club_id, actor.user_id, "club.challenge_expiry", "club", str(club_id), str(payload.challenge_expiry_days))
    await session.commit()
    return {"challenge_expiry_days": club.challenge_expiry_days, "reminder_after_days": REMIND_AFTER.days}


@router.post("/v1/clubs/{club_id}/challenges/maintenance")
async def run_challenge_maintenance(club_id: UUID, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Admin trigger for the same reminder/expiry pass the scheduler runs every 15 minutes."""
    await require_club_admin(session, club_id, actor)
    return await challenge_maintenance(session, club_id)


@router.get("/v1/clubs/{club_id}/head-to-head/{player_a}/{player_b}")
async def head_to_head(club_id: UUID, player_a: str, player_b: str, session: AsyncSession = Depends(get_session), actor: Actor = Depends(current_actor)) -> dict:
    """Every finalized meeting between two players, with each player's rating change in that match."""
    viewer = await require_member(session, club_id, actor.user_id)
    staff = is_staff(viewer)
    return await h2h(session, club_id, player_a, player_b, lambda p: visible(p, actor.user_id, staff), await hidden_for(session, club_id, actor.user_id, staff))


@router.get("/v1/public/clubs/{slug}/head-to-head/{player_a}/{player_b}")
async def public_head_to_head(slug: str, player_a: str, player_b: str, session: AsyncSession = Depends(get_session)) -> dict:
    """Shareable link: only when both players chose a public profile; non-public partners are anonymised."""
    club = await session.scalar(select(Club).where(Club.slug == slug))
    if club is None:
        raise HTTPException(status_code=404, detail="Player not available")
    public = set((await session.scalars(select(PlayerProfile.user_id).where(PlayerProfile.club_id == club.id, PlayerProfile.visibility == "public"))).all())
    members = set(await names_for(session, club.id))
    return await h2h(session, club.id, player_a, player_b, lambda p: p is not None and p.visibility == "public", members - public)


async def h2h(session: AsyncSession, club_id: UUID, player_a: str, player_b: str, can_see, hidden: set[str]) -> dict:
    if player_a == player_b:
        raise HTTPException(status_code=422, detail="Choose two different players")
    names = await names_for(session, club_id)
    profiles = {p.user_id: p for p in (await session.scalars(select(PlayerProfile).where(PlayerProfile.club_id == club_id, PlayerProfile.user_id.in_([player_a, player_b])))).all()}
    for u in (player_a, player_b):
        if u not in names or not can_see(profiles.get(u)):
            raise HTTPException(status_code=404, detail="Player not available")'''),
])

edit("backend/app/recaps.py", [
    ('''        now = datetime.now(CLUB_TZ)
        if (now.weekday() == 0 or now.day == 1) and now.hour >= 8:''', '''        now = datetime.now(CLUB_TZ)
        try:
            from .challenges import challenge_maintenance

            async with SessionLocal() as session:
                for club_id in (await session.scalars(select(Club.id))).all():
                    done = await challenge_maintenance(session, club_id)
                    if done["reminded"] or done["expired"]:
                        logger.info("challenges %s: %s", club_id, done)
        except Exception:
            logger.exception("challenge reminders failed")
        if (now.weekday() == 0 or now.day == 1) and now.hour >= 8:'''),
])

edit("backend/app/ratings.py", [
    ('''        await my_preferences(session, club_id, actor)
        await audit(session, club_id, actor.user_id, "membership.self_joined"''', '''        prefs = await my_preferences(session, club_id, actor)
        if admin:  # club admins start opted in to both emails (inbox check); they can switch off in Edit profile
            prefs.weekly_recap = prefs.monthly_digest = True
        await audit(session, club_id, actor.user_id, "membership.self_joined"'''),
])
print("ok")
