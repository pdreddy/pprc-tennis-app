import os

os.chdir("/app")


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:80])
        s = s.replace(a, b, 1)
    open(p, "w").write(s)


edit("backend/app/challenges.py", [
    ('''    return {**challenge_view(c, actor.user_id, names, None), "emailed": emailed}''', '''    return {**challenge_view(c, actor.user_id, names, None, await expiry_days(session, club_id)), "emailed": emailed}'''),
    ('''    c.status, c.responded_at = ("accepted" if payload.action == "accept" else "declined"), datetime.now(timezone.utc)
    c.awaiting_id = None''', '''    countered = actor.user_id == c.challenger_id or (c.last_action_at and c.created_at and c.last_action_at - c.created_at > timedelta(seconds=5))
    c.status, c.responded_at = ("accepted" if payload.action == "accept" else "declined"), datetime.now(timezone.utc)
    c.awaiting_id = None'''),
    ('''{'your challenge' if other == c.challenger_id else 'the new time'}''', '''{'the new time' if countered else 'your challenge'}'''),
])
edit("backend/app/emailer.py", [
    ('''        if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):''', '''        if e.response.status_code == 429:
            logger.warning("Email rate limited by provider")
            raise HTTPException(status_code=429, detail="Email is busy right now, try again in a minute")
        if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached"):'''),
])
for p in ("backend/app/recaps.py", "backend/app/digest.py"):
    edit(p, [("            if exc.status_code == 503:", "            if exc.status_code in (429, 503):")])

edit("apps/web/src/rivalry-share.tsx", [
    ('''  ctx.fillText(last ? `Last: ${last.a_won ? d.a.display_name : d.b.display_name} won ${last.score_text ?? ""}`.trim() : "First meeting coming soon", 90, 1110, 900);''',
     '''  const winnerScore = last?.score_text && !last.a_won ? last.score_text.replace(/(\\d+)-(\\d+)/g, "$2-$1") : last?.score_text ?? "";
  ctx.fillText(last ? `Last: ${last.a_won ? d.a.display_name : d.b.display_name} won ${winnerScore}`.trim() : "First meeting coming soon", 90, 1110, 900);'''),
    ('''new Date(last.played_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })''', '''new Date(last.played_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "America/Chicago" })'''),
    ('''    link.click();
    URL.revokeObjectURL(link.href);''', '''    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);'''),
    ('''    await navigator.clipboard?.writeText(url);
    setStatus("Link copied · it opens for anyone when both players have public profiles");''', '''    try {
      await navigator.clipboard.writeText(url);
      setStatus("Link copied · it opens for anyone when both players have public profiles");
    } catch {
      setStatus(`Copy this link: ${url}`);
    }'''),
])
edit("apps/web/src/milestones.tsx", [('''    link.click();
    URL.revokeObjectURL(link.href);''', '''    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);''')])
edit("apps/web/src/members-admin.tsx", [
    ('''className="pr-days-input" data-testid="challenge-expiry-input" />''', '''className="pr-days-input" onChange={() => setMessage("")} data-testid="challenge-expiry-input" />'''),
])
edit("apps/web/src/rivalry.tsx", [
    ('import { Empty, Panel, date } from "./ui";', 'import { Swords } from "lucide-react";\nimport { Empty, Panel, date } from "./ui";'),
    ('<Empty title="Head to head not available">', '<Empty title="Head to head not available" icon={<Swords size={32} />}>'),
    ('<Empty title="They have not met yet">', '<Empty title="They have not met yet" icon={<Swords size={32} />}>'),
])
open("apps/web/src/players.css", "a").write('''.pr-challenge .row { justify-content: flex-start; flex-wrap: wrap; gap: 8px; }
.empty > svg { margin-inline: auto; display: block; }
''')
print("ok")
