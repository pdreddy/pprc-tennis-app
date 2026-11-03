import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listFairMatches, photoUrl, type RatingKind } from "./api";
import { Tabs } from "./components";
import { ChallengeButton } from "./challenges";
import { useSession } from "./context";
import { Empty, Panel } from "./ui";

const spreads = [
  { value: "0.25", label: "±0.25" },
  { value: "0.5", label: "±0.5" },
  { value: "1", label: "±1.0" },
];

/** Opponents whose PPRC Rating is close to yours, closest first. */
export function FairMatches({ onPick }: { onPick?: (opponent: { id: string; name: string }) => void }) {
  const [kind, setKind] = useState<RatingKind>("singles");
  const [spread, setSpread] = useState("0.5");
  const { user } = useSession();
  const q = useQuery({ queryKey: ["fair-matches", kind, spread], queryFn: () => listFairMatches(kind, Number(spread)) });
  return (
    <Panel title="Fair match finder" action={<Tabs label="Rating kind" value={kind} onChange={setKind} options={[{ value: "singles", label: "Singles" }, { value: "doubles", label: "Doubles" }]} />}>
      <div className="pr-fair-head">
        <p className="hint">Players within your rating range. Close matches move ratings fairly and make better tennis.</p>
        <Tabs label="Rating range" value={spread} onChange={setSpread} options={spreads} />
      </div>
      {q.isLoading ? <p role="status">Finding opponents…</p> : q.error ? <p role="alert" className="error">{(q.error as Error).message}</p> : !q.data?.length ? (
        <div data-testid="fair-matches-empty"><Empty title="No one in range yet">Widen the range or play a first verified match to get a rating.</Empty></div>
      ) : (
        <ul className="pr-fair" data-testid="fair-matches">
          {q.data.map((o) => (
            <li key={o.user_id} data-testid={`fair-match-${o.user_id}`}>
              {o.image_url ? <img className="pr-avatar sm" src={photoUrl(o.image_url) ?? undefined} alt="" /> : <span className="pr-avatar sm">{o.display_name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>}
              <span className="pr-fair-name">
                <Link to={`/players/${o.user_id}`}><strong>{o.display_name}</strong></Link>
                <small>{o.city ?? "PPRC"} · <Link to={`/players/${user?.uid}/vs/${o.user_id}`} data-testid={`fair-match-h2h-${o.user_id}`}>Head to head {o.head_to_head.wins}-{o.head_to_head.losses}</Link></small>
              </span>
              <span className="pr-fair-rating">
                <strong>{o.rating.toFixed(2)}</strong>
                <small className={o.gap > 0 ? "up" : o.gap < 0 ? "down" : ""}>{o.gap > 0 ? "+" : ""}{o.gap.toFixed(2)}{o.provisional ? " · P" : ""}</small>
              </span>
              {onPick && kind === "singles" && (
                <span className="pr-fair-actions">
                  <ChallengeButton opponent={{ id: o.user_id, name: o.display_name }} />
                  <button className="button secondary small" onClick={() => onPick({ id: o.user_id, name: o.display_name })} data-testid={`fair-match-report-${o.user_id}`}>Report match</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
