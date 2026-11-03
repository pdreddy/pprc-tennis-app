import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listRivalries, type ApiRivalry, type RatingKind } from "./api";
import { Tabs } from "./components";
import { Empty, Panel } from "./ui";

const views = [
  { value: "most_played", label: "Most played" },
  { value: "closest", label: "Closest" },
  { value: "one_sided", label: "One-sided" },
] as const;
type View = (typeof views)[number]["value"];
const hint: Record<View, string> = {
  most_played: "Pairs who have met most often.",
  closest: "The tightest head-to-head records (within 2 wins).",
  one_sided: "One player has won every meeting so far.",
};

function Row({ r, rank }: { r: ApiRivalry; rank: number }) {
  return (
    <li data-testid={`rivalry-row-${rank}`}>
      <span className="pr-riv-rank">{rank}</span>
      <Link to={`/players/${r.a.user_id}/vs/${r.b.user_id}`} className="pr-riv-names">
        <strong>{r.a.display_name}</strong> <span>vs</span> <strong>{r.b.display_name}</strong>
      </Link>
      <span className="pr-riv-record" data-testid={`rivalry-record-${rank}`}>{r.a_wins}–{r.b_wins}</span>
      <small>{r.meetings} meetings</small>
    </li>
  );
}

/** Club rivalry leaderboard on the rankings page (signed-in members, private players excluded). */
export function RivalryBoard({ kind }: { kind: RatingKind }) {
  const [view, setView] = useState<View>("most_played");
  const q = useQuery({ queryKey: ["rivalries", kind], queryFn: () => listRivalries(kind) });
  const rows = q.data?.[view] ?? [];
  return (
    <Panel title="Rivalries" action={<Tabs label="Rivalry view" value={view} onChange={setView} options={views} />}>
      <p className="hint">{hint[view]} At least 2 rated {kind} meetings.</p>
      {q.isLoading ? <p role="status">Loading rivalries…</p> : q.error ? <p role="alert" className="error" data-testid="rivalries-error">{(q.error as Error).message}</p> : !rows.length ? (
        <div data-testid="rivalries-empty"><Empty title="No rivalries yet">Play the same opponent twice to start one.</Empty></div>
      ) : (
        <ol className="pr-rivalries" data-testid="rivalries-list">{rows.map((r, i) => <Row key={`${r.a.user_id}-${r.b.user_id}`} r={r} rank={i + 1} />)}</ol>
      )}
    </Panel>
  );
}
