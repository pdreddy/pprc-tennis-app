import os
import re

os.chdir("/app")


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b)
    open(p, "w").write(s)


TABLE = '<table role="presentation" width="560" style="max-width:560px;background:#ffffff;border-radius:14px">'
WIDE = '<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px">'
for p in ("backend/app/recaps.py", "backend/app/digest.py", "backend/app/challenges.py"):
    edit(p, [(TABLE, WIDE), ('<tr><td align="center" style="padding:24px">', '<tr><td align="center" style="padding:16px 8px">')])

edit("backend/app/challenges.py", [
    ("import logging\nimport os\n", "import logging\nimport os\nimport re\n"),
    ("from sqlalchemy import or_, select\n", "from sqlalchemy import or_, select\nfrom sqlalchemy.exc import IntegrityError\n"),
    ("MAX_OPEN_SENT = 10\n", '''MAX_OPEN_SENT = 10
SET = re.compile(r"(\\d+)-(\\d+)(\\(\\d+\\))?")


def flip_score(text: str | None) -> str | None:
    """Scores are stored side-one first; flip each set to show the other side first."""
    return SET.sub(lambda m: f"{m.group(2)}-{m.group(1)}{m.group(3) or ''}", text) if text else text
'''),
    ('''    session.add(c)
    await session.flush()
    names = await names_for(session, club_id)''', '''    session.add(c)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail="You already have an open challenge with this player")
    names = await names_for(session, club_id)'''),
    ('''    c = await load_challenge(session, challenge_id, actor)
    if c.status != "accepted":
        raise HTTPException(status_code=409, detail="Only an accepted challenge can be reported")''', '''    c = await load_challenge(session, challenge_id, actor)
    previous = await session.get(RatedMatch, c.result_id) if c.result_id else None
    if not (c.status == "accepted" or (c.status == "completed" and previous is not None and previous.status == "cancelled")):
        raise HTTPException(status_code=409, detail="Only an accepted challenge (or one whose result was voided) can be reported")'''),
    ('''            "id": str(m.id), "kind": m.kind, "played_at": m.played_at, "score_text": m.score_text,''', '''            "id": str(m.id), "kind": m.kind, "played_at": m.played_at, "score_text": m.score_text if a_side == 1 else flip_score(m.score_text),'''),
    ('''    async def player(u: str) -> dict:
        p = profiles.get(u)
        ratings = {}
        for kind in ("singles", "doubles"):
            ordered = await club_ratings(session, club_id, kind)
            row = next((r for r in ordered if r.user_id == u), None)''', '''    ordered_by_kind = {kind: await club_ratings(session, club_id, kind) for kind in ("singles", "doubles")}

    async def player(u: str) -> dict:
        p = profiles.get(u)
        ratings = {}
        for kind, ordered in ordered_by_kind.items():
            row = next((r for r in ordered if r.user_id == u), None)'''),
    ('''    rows = (await session.scalars(select(RatedMatch).where(RatedMatch.club_id == club_id, RatedMatch.status == "finalized").order_by(RatedMatch.played_at.desc()))).all()''',
     '''    rows = (await session.scalars(select(RatedMatch).where(RatedMatch.club_id == club_id, RatedMatch.status == "finalized").order_by(RatedMatch.played_at.desc()).limit(5000))).all()'''),
])
edit("backend/app/models.py", [
    ('''    __tablename__ = "challenges"
''', '''    __tablename__ = "challenges"
    # At most one open challenge per pair (either direction); the API turns a race into a 409.
    __table_args__ = (Index("uq_challenge_open_pair", "club_id", "pair_key", unique=True, sqlite_where=text("status IN ('pending', 'accepted')"), postgresql_where=text("status IN ('pending', 'accepted')")),)
'''),
    ('''    result_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rated_matches.id", ondelete="SET NULL"), nullable=True)
''', '''    result_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rated_matches.id", ondelete="SET NULL"), nullable=True)
    pair_key: Mapped[str] = mapped_column(String(260), default=lambda ctx: "|".join(sorted([ctx.get_current_parameters()["challenger_id"], ctx.get_current_parameters()["opponent_id"]])))
'''),
    ("from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, TypeDecorator, UniqueConstraint, Uuid, func",
     "from sqlalchemy import JSON, Boolean, Date, DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Text, TypeDecorator, UniqueConstraint, Uuid, func, text"),
])
edit("backend/sql/011_challenges_digest.sql", [
    ("  result_id uuid references rated_matches(id) on delete set null,\n", "  result_id uuid references rated_matches(id) on delete set null,\n  pair_key varchar(260) not null,\n"),
    ("alter table challenges enable row level security;", "create unique index if not exists uq_challenge_open_pair on challenges (club_id, pair_key) where status in ('pending', 'accepted');\nalter table challenges enable row level security;"),
])

# Frontend
edit("apps/web/src/challenges.tsx", [
    ('import { StatusBadge } from "./components";\n', ""),
    ('''export function ChallengeButton({ opponent }: { opponent: { id: string; name: string } }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState("");
  if (sent)''', '''export function ChallengeButton({ opponent, openChallenge }: { opponent: { id: string; name: string }; openChallenge?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState("");
  if (openChallenge && !sent) return <Link className="pr-challenge-open" to={`/me/matches?challenge=${openChallenge}`} data-testid={`challenge-open-${opponent.id}`}>Challenge open</Link>;
  if (sent)'''),
    ('''        <StatusBadge status={c.status === "completed" && c.result_status === "finalized" ? "Rated" : statusText[c.status]} />''',
     '''        <span className={`pr-challenge-status ${c.status}`} data-testid={`challenge-status-${c.id}`}>{label(c)}</span>'''),
    ('''const statusText: Record<ApiChallenge["status"], string> = { pending: "Waiting for reply", accepted: "Accepted · play and report", declined: "Declined", cancelled: "Cancelled", completed: "Score reported" };''',
     '''const statusText: Record<ApiChallenge["status"], string> = { pending: "Waiting for reply", accepted: "Accepted · play and report", declined: "Declined", cancelled: "Cancelled", completed: "Score reported" };
const resultText: Record<string, string> = { finalized: "Rated", disputed: "Score disputed", cancelled: "Result voided" };
const label = (c: ApiChallenge) => (c.status === "completed" && c.result_status && resultText[c.result_status]) || statusText[c.status];'''),
    ('''      {c.status === "accepted" && <ReportChallenge id={c.id} />}
      {c.status === "completed" && c.result_status === "reported" && <small className="muted">Waiting for the other player to confirm the score.</small>}''',
     '''      {(c.status === "accepted" || (c.status === "completed" && c.result_status === "cancelled")) && <ReportChallenge id={c.id} />}
      {c.status === "completed" && c.result_status === "reported" && <small className="muted">Waiting for the other player to confirm the score.</small>}
      {c.status === "completed" && c.result_status === "disputed" && <small className="muted">An organizer will review the disputed score. If it is voided you can report it again here.</small>}'''),
])
edit("apps/web/src/fair-matches.tsx", [
    ('import { listFairMatches, photoUrl, type RatingKind } from "./api";', 'import { listChallenges, listFairMatches, photoUrl, type RatingKind } from "./api";'),
    ('''  const { user } = useSession();
''', '''  const { user } = useSession();
  const challenges = useQuery({ queryKey: ["challenges"], queryFn: listChallenges, enabled: !!onPick });
  const openWith = (id: string) => challenges.data?.find((c) => c.opponent.user_id === id && (c.status === "pending" || c.status === "accepted"))?.id;
'''),
    ('<ChallengeButton opponent={{ id: o.user_id, name: o.display_name }} />', '<ChallengeButton opponent={{ id: o.user_id, name: o.display_name }} openChallenge={openWith(o.user_id)} />'),
])
edit("apps/web/src/rivalry.tsx", [
    ('options={[{ value: "singles", label: `Singles (${summary.singles.a_wins + summary.singles.b_wins})` }, { value: "doubles", label: `Doubles (${summary.doubles.a_wins + summary.doubles.b_wins})` }]}',
     'options={[{ value: "singles", label: `Singles (${matches.filter((m) => m.kind === "singles").length})` }, { value: "doubles", label: `Doubles (${matches.filter((m) => m.kind === "doubles").length})` }]}'),
])
edit("apps/web/src/email-preview.tsx", [
    ('''    <Panel title="Email preview" action={<Tabs label="Email type" value={type} onChange={(t) => { setType(t); setState({ busy: false, message: "" }); }} options={types} />}>
      <p className="hint">{timing[type]}</p>''', '''    <Panel title="Email preview">
      <Tabs label="Email type" value={type} onChange={(t) => { setType(t); setState({ busy: false, message: "" }); }} options={types} />
      <p className="hint">{timing[type]}</p>'''),
])
edit("apps/web/src/players.tsx", [
    ('''<Action variant="primary" onClick={async () => { await confirmResult(result.id); await refresh(); }}>Confirm result</Action>''',
     '''<Action variant="primary" onClick={async () => { await confirmResult(result.id); await refresh(); }}><span data-testid={`confirm-result-${result.id}`}>Confirm result</span></Action>'''),
    ('''<PromptAction label="Dispute" title="Dispute this result"''', '''<span data-testid={`dispute-result-${result.id}`} className="pr-inline"><PromptAction label="Dispute" title="Dispute this result"'''),
    ('''onSubmit={async (reason) => { await disputeResult(result.id, reason); await refresh(); }} />
        </>''', '''onSubmit={async (reason) => { await disputeResult(result.id, reason); await refresh(); }} /></span>
        </>'''),
])
open("apps/web/src/players.css", "a").write('''
.pr-inline { display: contents; }
.pr-challenge-open { font-size: 13px; font-weight: 600; color: var(--teal); padding: 6px 10px; border-radius: 999px; background: #e6f4f3; }
.pr-challenge-status { flex-shrink: 0; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #eef3f6; color: #26394a; }
.pr-challenge-status.pending { background: #fff4d6; color: #7a5300; }
.pr-challenge-status.accepted { background: #e6f4f3; color: #065f60; }
.pr-challenge-status.completed { background: #e7f6ee; color: #0b6b4b; }
.pr-challenge-status.declined, .pr-challenge-status.cancelled { background: #f6e9e9; color: #8a2a2a; }
''')
print("ok")
