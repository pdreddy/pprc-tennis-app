import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getHeadToHead, photoUrl, type ApiH2HChange, type ApiH2HPlayer, type RatingKind } from "./api";
import { useSession } from "./context";
import { Tabs } from "./components";
import { Empty, Panel, date } from "./ui";
import "./players.css";

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function Side({ p, kind, align }: { p: ApiH2HPlayer; kind: RatingKind; align: "left" | "right" }) {
  const r = p.ratings[kind];
  return (
    <Link to={`/players/${p.user_id}`} className={`pr-h2h-side ${align}`} data-testid={`h2h-player-${align}`}>
      {p.image_url ? <img className="pr-avatar" src={photoUrl(p.image_url) ?? undefined} alt="" /> : <span className="pr-avatar">{initials(p.display_name)}</span>}
      <strong>{p.display_name}</strong>
      <small>{r ? `${r.rating.toFixed(2)}${r.provisional ? " P" : ""}${r.rank ? ` · #${r.rank}` : ""}` : "Unrated"}</small>
    </Link>
  );
}

function Delta({ change, testId }: { change: ApiH2HChange; testId: string }) {
  if (!change) return <span className="muted">—</span>;
  const d = change.delta;
  return <span className={d > 0 ? "up" : d < 0 ? "down" : ""} data-testid={testId}>{change.before.toFixed(2)} → {change.after.toFixed(2)} ({d >= 0 ? "+" : ""}{d.toFixed(2)})</span>;
}

/** Every result between two players and how each match moved both ratings. */
export function RivalryPage() {
  const { a = "", b = "" } = useParams();
  const { user } = useSession();
  const [kind, setKind] = useState<RatingKind>("singles");
  const q = useQuery({ queryKey: ["h2h", a, b], queryFn: () => getHeadToHead(a, b) });
  if (q.isLoading) return <div className="page" role="status">Loading head to head…</div>;
  if (q.error || !q.data) return <div className="page"><Empty title="Head to head not available">One of these players is private or not in the club.</Empty></div>;
  const { summary, matches } = q.data;
  const list = matches.filter((m) => m.kind === kind);
  const s = summary[kind];
  return (
    <div className="page" data-testid="rivalry-page">
      <p className="eyebrow">HEAD TO HEAD</p>
      <section className="pr-h2h-hero">
        <Side p={q.data.a} kind={kind} align="left" />
        <div className="pr-h2h-score" data-testid="h2h-score"><strong>{s.a_wins}</strong><span>–</span><strong>{s.b_wins}</strong><small>{kind} wins</small></div>
        <Side p={q.data.b} kind={kind} align="right" />
      </section>
      <Panel title="Every meeting" action={<Tabs label="Rating kind" value={kind} onChange={setKind} options={[{ value: "singles", label: `Singles (${summary.singles.a_wins + summary.singles.b_wins})` }, { value: "doubles", label: `Doubles (${summary.doubles.a_wins + summary.doubles.b_wins})` }]} />}>
        {!list.length ? (
          <div data-testid="h2h-empty"><Empty title="They have not met yet">{user?.uid === a ? "Send a challenge from My matches to start this rivalry." : "No finalized results between these players."}</Empty></div>
        ) : (
          <ul className="pr-h2h-list" data-testid="h2h-matches">
            {list.map((m) => (
              <li key={m.id} data-testid={`h2h-match-${m.id}`}>
                <span className="pr-h2h-when">{date(m.played_at)}{!m.rated && <small> · not rated</small>}</span>
                <span className="pr-h2h-result">
                  <strong className={m.a_won ? "win" : ""}>{q.data.a.display_name}{m.a_partners.length ? ` & ${m.a_partners.map((p) => p.display_name).join(", ")}` : ""}</strong>
                  <span className="pr-h2h-scoreline">{m.score_text ?? m.outcome}</span>
                  <strong className={m.a_won === false ? "win" : ""}>{q.data.b.display_name}{m.b_partners.length ? ` & ${m.b_partners.map((p) => p.display_name).join(", ")}` : ""}</strong>
                </span>
                <span className="pr-h2h-deltas"><Delta change={m.a_change} testId={`h2h-a-delta-${m.id}`} /><Delta change={m.b_change} testId={`h2h-b-delta-${m.id}`} /></span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
