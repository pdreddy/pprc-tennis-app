import os

os.chdir("/app")


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, "w").write(s)


edit("backend/app/challenges.py", [
    ('''    for m in rows:
        for one in m.side_one:
            for two in m.side_two:''', '''    for m in rows:
        if m.winner_side not in (1, 2):
            continue
        for one in m.side_one:
            for two in m.side_two:'''),
    ('''        "closest": sorted([p for p in pairs if p["b_wins"] > 0], key=''', '''        "closest": sorted([p for p in pairs if p["b_wins"] > 0 and p["a_wins"] - p["b_wins"] <= CLOSE_MARGIN], key='''),
    ('''REMIND_AFTER = timedelta(days=2)''', '''REMIND_AFTER = timedelta(days=2)
CLOSE_MARGIN = 2  # "closest" rivalries are within this many wins'''),
])
edit("backend/app/recaps.py", [
    ('''                            logger.info("weekly recap %s: %s", club_id, await send_club_recaps(session, club_id))''', '''                            if (done := await send_club_recaps(session, club_id))["sent"] or done["failed"]:
                                logger.info("weekly recap %s: %s", club_id, done)'''),
    ('''                            logger.info("monthly digest %s: %s", club_id, await send_club_digests(session, club_id))''', '''                            if (done := await send_club_digests(session, club_id))["sent"] or done["failed"]:
                                logger.info("monthly digest %s: %s", club_id, done)'''),
])
edit("apps/web/src/rivalries.tsx", [
    ('import { useSession } from "./context";\n', ''),
    ('function Row({ r, rank, me }: { r: ApiRivalry; rank: number; me?: string }) {', 'function Row({ r, rank }: { r: ApiRivalry; rank: number }) {'),
    ('  const { user } = useSession();\n', ''),
    (' rank={i + 1} me={user?.uid} />', ' rank={i + 1} />'),
    ('{q.isLoading ? <p role="status">Loading rivalries…</p> : !rows.length ?', '{q.isLoading ? <p role="status">Loading rivalries…</p> : q.error ? <p role="alert" className="error" data-testid="rivalries-error">{(q.error as Error).message}</p> : !rows.length ?'),
    ('  closest: "The tightest head-to-head records.",', '  closest: "The tightest head-to-head records (within 2 wins).",'),
])
edit("apps/web/src/challenges.tsx", [
    ('''Suggested {date(c.proposed_at, "America/Chicago", true)}''', '''Suggested {date(c.proposed_at, localZone, true)}'''),
    ('''Expires {date(c.expires_at, "America/Chicago", true)} if unanswered''', '''Expires {date(c.expires_at, localZone, true)} if unanswered'''),
    ('''const statusText: Record''', '''const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const statusText: Record'''),
])
open("apps/web/src/players.css", "a").write('''@media (max-width: 600px) {
  .pr-challenge-head { flex-direction: column-reverse; }
}
''')
print("ok")
