import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Minus, Search, UserRound } from "lucide-react";
import {
  confirmResult, disputeResult, finalizeResult, getMyPlayer, getPlayer, getPublicApiEvent, getPublicPlayer, listClubRankings, listClubResults,
  listMyResults, listPlatformRankings, listPlayers, listPublicApiDivisions, listPublicApiEvents, reportResult, saveMyPlayer, voidResult,
  type ApiPlayerDetail, type ApiRating, type ApiResult, type RatingKind,
} from "./api";
import { useSession, toUiEvent } from "./context";
import { CompetitionBoard } from "./competition";
import { Callout, DataTable, FieldGrid, PromptAction, StatGrid, StatusBadge, Tabs } from "./components";
import { Action, Empty, Field, Form, Panel, text } from "./ui";
import "./players.css";

const kinds = [{ value: "singles", label: "Singles" }, { value: "doubles", label: "Doubles" }] as const;
const fmt = (value: number | null | undefined) => (value == null ? "—" : value.toFixed(2));
const isStaff = (role: unknown) => ["clubAdmin", "eventAdmin"].includes(String(role));

export function RatingBadge({ rating, testId }: { rating: ApiRating | null | undefined; testId?: string }) {
  if (!rating) return <span className="pr-rating is-empty" data-testid={testId}>Unrated</span>;
  return (
    <span className="pr-rating" data-testid={testId}>
      <strong>{fmt(rating.rating)}</strong>
      {rating.provisional ? <em className="pr-prov">Provisional</em> : <em>Reliability {Math.round(rating.reliability)}%</em>}
    </span>
  );
}

function Reliability({ value }: { value: number }) {
  return (
    <span className="pr-rel" aria-label={`Reliability ${Math.round(value)} percent`}>
      <i style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
}

function Movement({ value = 0 }: { value?: number }) {
  if (!value) return <span className="pr-move"><Minus size={14} /></span>;
  return <span className={`pr-move ${value > 0 ? "up" : "down"}`}>{value > 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}{Math.abs(value)}</span>;
}

function Avatar({ name, src }: { name: string; src?: string | null }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return src ? <img className="pr-avatar" src={src} alt="" /> : <span className="pr-avatar">{initials}</span>;
}

function RatingChart({ points }: { points: { played_at: string; rating: number }[] }) {
  if (points.length < 2) return <p className="hint">The chart appears after two verified matches.</p>;
  const values = points.map((p) => p.rating);
  const min = Math.min(...values) - 0.2, max = Math.max(...values) + 0.2;
  const xy = points.map((p, i) => `${(i / (points.length - 1)) * 300},${100 - ((p.rating - min) / (max - min)) * 100}`);
  return (
    <svg className="pr-chart" viewBox="-4 -6 308 112" role="img" aria-label="Rating history chart" data-testid="rating-history-chart">
      <polyline points={xy.join(" ")} />
      {xy.map((pt, i) => <circle key={i} cx={pt.split(",")[0]} cy={pt.split(",")[1]} r="3" />)}
    </svg>
  );
}

function PlayerDetailView({ detail, children }: { detail: ApiPlayerDetail; children?: ReactNode }) {
  const [kind, setKind] = useState<RatingKind>("singles");
  const { profile, ratings } = detail;
  return (
    <div className="pr-detail" data-testid="player-detail">
      <header className="pr-hero">
        <Avatar name={profile.display_name} src={profile.image_url} />
        <div>
          <p className="eyebrow">{[profile.city, profile.state].filter(Boolean).join(", ") || "PPRC member"}{profile.home_club ? ` · ${profile.home_club}` : ""}</p>
          <h1 data-testid="player-name">{profile.display_name}</h1>
          <div className="pr-form" aria-label="Recent form">{detail.recent_form.map((r, i) => <span key={i} className={r === "W" ? "w" : "l"}>{r}</span>)}</div>
        </div>
        {children}
      </header>
      <div className="pr-rating-cards">
        {(["singles", "doubles"] as const).map((k) => (
          <section key={k} className="pr-card" data-testid={`rating-card-${k}`}>
            <p className="pp-section-title">PPRC {k} rating</p>
            <RatingBadge rating={ratings[k]} testId={`rating-value-${k}`} />
            {ratings[k] && (
              <>
                <Reliability value={ratings[k]!.reliability} />
                <small>{ratings[k]!.verified_matches} verified · {ratings[k]!.wins}-{ratings[k]!.losses}{ratings[k]!.rank ? ` · Club rank #${ratings[k]!.rank}` : ""}</small>
              </>
            )}
          </section>
        ))}
      </div>
      <StatGrid items={[{ label: "Record", value: `${detail.record.wins}-${detail.record.losses}` }, { label: "Matches rated", value: (ratings.singles?.verified_matches ?? 0) + (ratings.doubles?.verified_matches ?? 0) }, { label: "Formula", value: ratings.singles?.formula_version ?? "pprc-rating-1.0" }]} />
      <Panel title="Rating history" action={<Tabs label="Rating kind" value={kind} onChange={setKind} options={kinds} />}>
        <RatingChart points={detail.history.filter((h) => h.kind === kind)} />
      </Panel>
      {detail.doubles_partners && detail.doubles_partners.length > 0 && (
        <Panel title="Doubles partners">
          <div className="pr-chips">{detail.doubles_partners.map((p) => <Link key={p.user_id} to={`/players/${p.user_id}`} className="pr-chip">{p.display_name}</Link>)}</div>
        </Panel>
      )}
      {detail.recent_matches && <ResultList title="Recent matches" results={detail.recent_matches} />}
    </div>
  );
}

export function PlayerPage() {
  const { userId = "" } = useParams();
  const { user } = useSession();
  const q = useQuery({ queryKey: ["player", userId, user?.uid], queryFn: () => (user ? getPlayer(userId) : getPublicPlayer(userId)) });
  if (q.isLoading) return <div className="page" role="status">Loading player…</div>;
  if (q.error || !q.data) return <div className="page"><Empty title="Player not available">This profile is private or does not exist.</Empty></div>;
  return <div className="page"><PlayerDetailView detail={q.data} /></div>;
}

export function PlayersDirectory() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["players", filters, page], queryFn: () => listPlayers({ ...filters, page, page_size: 24 }) });
  const set = (key: string, value: string) => { setPage(1); setFilters((f) => ({ ...f, [key]: value })); };
  return (
    <div className="page" data-testid="players-page">
      <p className="eyebrow">THE CLUB</p>
      <h1>Players</h1>
      <div className="pr-filters">
        <label className="search-field"><Search size={18} /><input aria-label="Search players" data-testid="players-search" placeholder="Search by name" value={filters.q ?? ""} onChange={(e) => set("q", e.target.value)} /></label>
        <input aria-label="City" placeholder="City" value={filters.city ?? ""} onChange={(e) => set("city", e.target.value)} data-testid="players-city" />
        <input aria-label="Club" placeholder="Club" value={filters.home_club ?? ""} onChange={(e) => set("home_club", e.target.value)} />
        <input aria-label="Minimum rating" type="number" step="0.5" min="1" max="16.5" placeholder="Min rating" value={filters.min_rating ?? ""} onChange={(e) => set("min_rating", e.target.value)} />
        <input aria-label="Maximum rating" type="number" step="0.5" min="1" max="16.5" placeholder="Max rating" value={filters.max_rating ?? ""} onChange={(e) => set("max_rating", e.target.value)} />
        <select aria-label="Age group" value={filters.age_group ?? ""} onChange={(e) => set("age_group", e.target.value)}>
          <option value="">Any age</option>{["Junior 14-17", "Adult 18+", "Adult 35+", "Adult 50+"].map((a) => <option key={a}>{a}</option>)}
        </select>
      </div>
      {q.isLoading ? <p role="status">Loading players…</p> : q.error ? <p role="alert" className="error">{(q.error as Error).message}</p> : (
        <>
          <p className="muted"><strong>{q.data!.total}</strong> players</p>
          <div className="pr-grid">
            {q.data!.items.length === 0 && <Empty title="No players match" />}
            {q.data!.items.map((p) => (
              <Link key={p.user_id} to={`/players/${p.user_id}`} className="pr-player" data-testid={`player-card-${p.user_id}`}>
                <Avatar name={p.display_name} src={p.image_url} />
                <span><strong>{p.display_name}</strong><small>{p.city ?? "—"}</small></span>
                <RatingBadge rating={p.rating} />
              </Link>
            ))}
          </div>
          <Pager page={page} total={q.data!.total} size={24} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages === 1) return null;
  return (
    <div className="pr-pager">
      <button className="button secondary small" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="pager-prev">Previous</button>
      <span>Page {page} of {pages}</span>
      <button className="button secondary small" disabled={page >= pages} onClick={() => onPage(page + 1)} data-testid="pager-next">Next</button>
    </div>
  );
}

export function RankingsPage() {
  const { user } = useSession();
  const [kind, setKind] = useState<RatingKind>("singles");
  const [scope, setScope] = useState<"club" | "platform">(user ? "club" : "platform");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["rankings", scope, kind, filters, page],
    queryFn: () => (scope === "club" ? listClubRankings({ kind, ...filters, page, page_size: 25 }) : listPlatformRankings({ kind, page, page_size: 25 })),
  });
  const set = (key: string, value: string) => { setPage(1); setFilters((f) => ({ ...f, [key]: value })); };
  return (
    <div className="page" data-testid="rankings-page">
      <p className="eyebrow">PPRC RATING</p>
      <h1>Rankings</h1>
      <div className="pr-toolbar">
        <Tabs label="Rating kind" value={kind} onChange={(k) => { setKind(k); setPage(1); }} options={kinds} />
        <Tabs label="Ranking scope" value={scope} onChange={(s) => { setScope(s); setPage(1); }} options={[...(user ? [{ value: "club" as const, label: "Club" }] : []), { value: "platform" as const, label: "All clubs" }]} />
      </div>
      {scope === "club" && (
        <div className="pr-filters">
          <input aria-label="City" placeholder="City" value={filters.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          <input aria-label="State" placeholder="State" value={filters.state ?? ""} onChange={(e) => set("state", e.target.value)} />
          <select aria-label="Age group" value={filters.age_group ?? ""} onChange={(e) => set("age_group", e.target.value)}><option value="">Any age</option>{["Junior 14-17", "Adult 18+", "Adult 35+", "Adult 50+"].map((a) => <option key={a}>{a}</option>)}</select>
          <select aria-label="Gender category" value={filters.gender_category ?? ""} onChange={(e) => set("gender_category", e.target.value)}><option value="">Any category</option>{["Open", "Men", "Women"].map((a) => <option key={a}>{a}</option>)}</select>
          <input aria-label="Minimum rating" type="number" step="0.5" placeholder="Min rating" value={filters.min_rating ?? ""} onChange={(e) => set("min_rating", e.target.value)} />
          <input aria-label="Maximum rating" type="number" step="0.5" placeholder="Max rating" value={filters.max_rating ?? ""} onChange={(e) => set("max_rating", e.target.value)} />
        </div>
      )}
      {scope === "platform" && <Callout>All-clubs rankings list only players who made their profile public.</Callout>}
      {q.isLoading ? <p role="status">Loading rankings…</p> : q.error ? <p role="alert" className="error">{(q.error as Error).message}</p> : (
        <>
          <DataTable
            caption={`${kind === "singles" ? "Singles" : "Doubles"} · ${q.data!.total} rated players`}
            rows={q.data!.items}
            rowKey={(r) => `${r.club_name ?? ""}${r.user_id}`}
            empty={<Empty title="No rated players yet" />}
            columns={[
              { key: "rank", header: "#", className: "rank", cell: (r) => <span data-testid={`rank-${r.rank}`}>{r.rank}</span> },
              { key: "move", header: "30d", cell: (r) => <Movement value={r.movement} /> },
              { key: "player", header: "Player", cell: (r) => scope === "club" ? <Link to={`/players/${r.user_id}`}><strong>{r.display_name}</strong></Link> : <strong>{r.display_name}</strong> },
              { key: "where", header: scope === "club" ? "City" : "Club", cell: (r) => (scope === "club" ? r.city : r.club_name) ?? "—" },
              { key: "rating", header: "Rating", numeric: true, cell: (r) => <><strong>{fmt(r.rating)}</strong>{r.provisional && <em className="pr-prov">P</em>}</> },
              { key: "rel", header: "Reliability", cell: (r) => <Reliability value={r.reliability} /> },
              { key: "rec", header: "W-L", numeric: true, cell: (r) => `${r.wins}-${r.losses}` },
              { key: "last", header: "Last played", cell: (r) => (r.last_played_at ? new Date(r.last_played_at).toLocaleDateString() : "—") },
            ]}
          />
          <Pager page={page} total={q.data!.total} size={25} onPage={setPage} />
          <p className="hint">P = provisional (fewer than 5 verified matches). PPRC Rating is PPRC's own rating, formula pprc-rating-1.0.</p>
        </>
      )}
    </div>
  );
}

export function MyRating() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-player"], queryFn: getMyPlayer });
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return <div className="page" role="status">Loading your rating…</div>;
  if (q.error) return <div className="page"><Empty title="Join the club first">{(q.error as Error).message}</Empty></div>;
  const detail = q.data!;
  const onboarding = !detail.profile.has_profile;
  const locked = (detail.ratings.singles?.verified_matches ?? 0) + (detail.ratings.doubles?.verified_matches ?? 0) > 0;
  return (
    <div className="page" data-testid="my-rating-page">
      {onboarding || editing ? (
        <Panel title={onboarding ? "Set up your PPRC player profile" : "Edit profile"}>
          {onboarding && <Callout>Choose a starting level. It stays provisional until you complete 5 verified matches.</Callout>}
          <Form label={onboarding ? "Create my profile" : "Save profile"} onSubmit={async (form) => {
            await saveMyPlayer({
              display_name: text(form, "displayName"), city: text(form, "city") || null, state: text(form, "state") || null,
              home_club: text(form, "homeClub") || null, image_url: text(form, "imageUrl") || null, preferred_sport: text(form, "sport") || "tennis",
              age_group: text(form, "ageGroup") || null, gender_category: text(form, "gender") || null,
              visibility: text(form, "visibility") as "public" | "club" | "private",
              ...(locked ? {} : { starting_singles: Number(text(form, "startSingles")), starting_doubles: Number(text(form, "startDoubles")) }),
            });
            setEditing(false);
            await qc.invalidateQueries();
          }}>
            <FieldGrid>
              <Field label="Display name"><input name="displayName" defaultValue={detail.profile.display_name} required minLength={2} data-testid="profile-name-input" /></Field>
              <Field label="City"><input name="city" defaultValue={detail.profile.city ?? ""} /></Field>
              <Field label="State"><input name="state" defaultValue={detail.profile.state ?? ""} maxLength={60} /></Field>
              <Field label="Home club"><input name="homeClub" defaultValue={detail.profile.home_club ?? "Prosper Premier Racquet Club"} /></Field>
              <Field label="Profile image URL"><input name="imageUrl" type="url" defaultValue={detail.profile.image_url ?? ""} placeholder="https://…" /></Field>
              <Field label="Preferred sport"><select name="sport" defaultValue={detail.profile.preferred_sport ?? "tennis"}><option value="tennis">Tennis</option><option value="pickleball">Pickleball</option></select></Field>
              <Field label="Age group"><select name="ageGroup" defaultValue={detail.profile.age_group ?? ""}><option value="">Prefer not to say</option>{["Junior 14-17", "Adult 18+", "Adult 35+", "Adult 50+"].map((a) => <option key={a}>{a}</option>)}</select></Field>
              <Field label="Category"><select name="gender" defaultValue={detail.profile.gender_category ?? ""}><option value="">Prefer not to say</option>{["Open", "Men", "Women"].map((a) => <option key={a}>{a}</option>)}</select></Field>
              <Field label="Who can see my profile"><select name="visibility" defaultValue={detail.profile.visibility ?? "club"} data-testid="profile-visibility-select"><option value="public">Everyone (public)</option><option value="club">Club members</option><option value="private">Only me and club staff</option></select></Field>
              {!locked && <Field label="Starting singles level" hint="1.00 beginner – 16.50 elite"><input name="startSingles" type="number" step="0.25" min="1" max="16.5" defaultValue={detail.profile.starting_singles ?? 5} required data-testid="start-singles-input" /></Field>}
              {!locked && <Field label="Starting doubles level"><input name="startDoubles" type="number" step="0.25" min="1" max="16.5" defaultValue={detail.profile.starting_doubles ?? 5} required /></Field>}
            </FieldGrid>
          </Form>
        </Panel>
      ) : (
        <PlayerDetailView detail={detail}>
          <button className="button secondary small" onClick={() => setEditing(true)} data-testid="edit-profile-btn"><UserRound size={15} /> Edit profile</button>
        </PlayerDetailView>
      )}
    </div>
  );
}

function sideNames(side: ApiResult["side_one"]) {
  return side.map((p) => p.display_name).join(" / ");
}

function ResultActions({ result, staff }: { result: ApiResult; staff: boolean }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  if (result.source !== "reported") return null;
  const reporterOnOne = result.side_one.some((p) => p.user_id === result.reported_by);
  const opponent = (reporterOnOne ? result.side_two : result.side_one).some((p) => p.user_id === user?.uid);
  return (
    <div className="pp-match-actions">
      {result.status === "reported" && opponent && (
        <>
          <Action variant="primary" onClick={async () => { await confirmResult(result.id); await refresh(); }}>Confirm result</Action>
          <PromptAction label="Dispute" title="Dispute this result" promptLabel="What is wrong with this result?" submitLabel="Send dispute" onSubmit={async (reason) => { await disputeResult(result.id, reason); await refresh(); }} />
        </>
      )}
      {staff && result.status !== "cancelled" && (
        <PromptAction label={result.status === "finalized" ? "Correct score" : "Verify"} title="Organizer verification" promptLabel="Reason (kept in the audit history)" submitLabel={result.status === "finalized" ? "Save correction" : "Verify and rate"} onSubmit={async (reason) => { await finalizeResult(result.id, { reason }); await refresh(); }} />
      )}
      {(staff || (result.status === "reported" && result.reported_by === user?.uid)) && result.status !== "cancelled" && (
        <PromptAction label="Void" title="Void this result" promptLabel="Reason" submitLabel="Void result" onSubmit={async (reason) => { await voidResult(result.id, reason); await refresh(); }} />
      )}
    </div>
  );
}

function ResultList({ title, results }: { title: string; results: ApiResult[] }) {
  const { member } = useSession();
  return (
    <Panel title={title}>
      {results.length === 0 && <Empty title="No matches yet">Report a match to start building your rating.</Empty>}
      {results.map((r) => (
        <article key={r.id} className="pp-match" data-testid={`result-${r.id}`}>
          <div className="pp-match-head">
            <span>{new Date(r.played_at).toLocaleDateString()} · {r.kind} · {r.source === "competition" ? "Event match" : "Reported"}</span>
            <span className="pr-tags"><StatusBadge status={r.status} />{r.status === "finalized" && <StatusBadge status={r.rated ? "Rated" : `Not rated (${r.outcome.replace("_", " ")})`} tone={r.rated ? "success" : "neutral"} />}</span>
          </div>
          <div className={`pp-side${r.winner_side === 1 ? " is-winner" : ""}`}><span className="pp-side-name">{sideNames(r.side_one)}</span></div>
          <div className={`pp-side${r.winner_side === 2 ? " is-winner" : ""}`}><span className="pp-side-name">{sideNames(r.side_two)}</span></div>
          <div className="pp-match-body">
            <p className="pp-match-note">{r.score_text ?? "No score"}{r.dispute_reason ? ` · Disputed: ${r.dispute_reason}` : ""}{r.correction_reason ? ` · Organizer note: ${r.correction_reason}` : ""}</p>
            <ResultActions result={r} staff={isStaff(member?.role)} />
          </div>
        </article>
      ))}
    </Panel>
  );
}

function ReportForm() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<RatingKind>("singles");
  const players = useQuery({ queryKey: ["players", "all"], queryFn: () => listPlayers({ page_size: 100 }) });
  const { user } = useSession();
  const options = (players.data?.items ?? []).filter((p) => p.user_id !== user?.uid);
  const select = (name: string, label: string) => (
    <Field label={label}><select name={name} required data-testid={`report-${name}`}><option value="">Choose a player</option>{options.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></Field>
  );
  return (
    <Panel title="Report a match" action={<Tabs label="Match kind" value={kind} onChange={setKind} options={kinds} />}>
      <Form label="Send for confirmation" onSubmit={async (form) => {
        const outcome = text(form, "outcome");
        await reportResult({
          kind, outcome, match_format: text(form, "format"), score_text: text(form, "score") || undefined,
          partner_id: kind === "doubles" ? text(form, "partner") : undefined,
          opponent_ids: kind === "doubles" ? [text(form, "opponent"), text(form, "opponent2")] : [text(form, "opponent")],
          winner_side: text(form, "winner") ? (Number(text(form, "winner")) as 1 | 2) : undefined,
          played_at: text(form, "playedAt") ? new Date(text(form, "playedAt")).toISOString() : undefined,
        });
        await qc.invalidateQueries();
      }}>
        <FieldGrid>
          {kind === "doubles" && select("partner", "Your partner")}
          {select("opponent", kind === "doubles" ? "Opponent 1" : "Opponent")}
          {kind === "doubles" && select("opponent2", "Opponent 2")}
          <Field label="Score (your side first)" hint="e.g. 6-3 4-6 10-7"><input name="score" placeholder="6-3 6-4" maxLength={120} data-testid="report-score" /></Field>
          <Field label="Outcome"><select name="outcome" defaultValue="completed"><option value="completed">Completed</option><option value="retired">Retired</option><option value="walkover">Walkover</option><option value="incomplete">Incomplete</option><option value="no_score">No score kept</option></select></Field>
          <Field label="Winner" hint="Needed when there is no full score"><select name="winner" defaultValue=""><option value="">From the score</option><option value="1">My side</option><option value="2">Opponents</option></select></Field>
          <Field label="Format"><select name="format" defaultValue="best_of_3"><option value="best_of_3">Best of 3 sets</option><option value="pro_set">Pro set</option><option value="one_set">One set</option><option value="tiebreak">Match tiebreak only</option><option value="best_of_5">Best of 5</option></select></Field>
          <Field label="Played on"><input name="playedAt" type="datetime-local" /></Field>
        </FieldGrid>
      </Form>
      <p className="hint">Only confirmed or organizer-verified results with a real score are rated. Walkovers, incomplete and no-score matches never change ratings.</p>
    </Panel>
  );
}

export function MyMatches() {
  const { member } = useSession();
  const staff = isStaff(member?.role);
  const mine = useQuery({ queryKey: ["results", "mine"], queryFn: listMyResults });
  const queue = useQuery({ queryKey: ["results", "queue"], queryFn: () => listClubResults(), enabled: staff });
  const pending = (mine.data ?? []).filter((r) => r.status === "reported");
  return (
    <div className="page" data-testid="my-matches-page">
      <p className="eyebrow">RESULTS</p>
      <h1>My matches</h1>
      {pending.length > 0 && <Callout tone="warn">{pending.length} result{pending.length > 1 ? "s" : ""} waiting for confirmation.</Callout>}
      <ReportForm />
      {mine.isLoading ? <p role="status">Loading…</p> : <ResultList title="My results" results={mine.data ?? []} />}
      {staff && <ResultList title="Club results needing attention" results={(queue.data ?? []).filter((r) => r.status === "reported" || r.status === "disputed")} />}
    </div>
  );
}

export function LadderPage() {
  const { user, member } = useSession();
  const ladders = useQuery({
    queryKey: ["ladders"],
    queryFn: async () => {
      const events = await listPublicApiEvents();
      const found = [];
      for (const event of events) for (const d of await listPublicApiDivisions(event.id)) if (d.format === "ladder") found.push({ event: toUiEvent(await getPublicApiEvent(event.id)), division: d });
      return found;
    },
  });
  if (ladders.isLoading) return <div className="page" role="status">Loading ladders…</div>;
  const list = ladders.data ?? [];
  return (
    <div className="page" data-testid="ladder-page">
      <p className="eyebrow">CHALLENGE UP</p>
      <h1>Ladder</h1>
      {list.length === 0 && <Empty title="No ladder is running" />}
      {list.map(({ event, division }) => (
        <section key={division.id}>
          <h2>{event.name}</h2>
          {user ? <CompetitionBoard division={{ ...division, clubId: division.club_id }} staff={isStaff(member?.role)} open /> : <Callout>Sign in to see the ladder and challenge players.</Callout>}
        </section>
      ))}
    </div>
  );
}
