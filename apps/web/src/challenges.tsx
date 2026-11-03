import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Swords } from "lucide-react";
import { cancelChallenge, listChallenges, reportChallenge, respondChallenge, sendChallenge, type ApiChallenge } from "./api";
import { useSession } from "./context";
import { Action, Empty, Field, Form, Panel, date, text } from "./ui";

/** Inline invite from a fair-match row: optional time and note, then the opponent is alerted in-app and by email. */
export function ChallengeButton({ opponent, openChallenge }: { opponent: { id: string; name: string }; openChallenge?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState("");
  if (openChallenge && !sent) return <Link className="pr-challenge-open" to={`/me/matches?challenge=${openChallenge}`} data-testid={`challenge-open-${opponent.id}`}>Challenge open</Link>;
  if (sent) return <small className="pr-challenge-sent" role="status" data-testid={`challenge-sent-${opponent.id}`}>{sent}</small>;
  return (
    <>
      <button className="button primary small" onClick={() => setOpen((v) => !v)} data-testid={`challenge-btn-${opponent.id}`}><Swords size={14} /> Challenge</button>
      {open && (
        <div className="pr-challenge-form" data-testid={`challenge-form-${opponent.id}`}>
          <Form label={`Send challenge to ${opponent.name}`} onSubmit={async (form) => {
            const when = text(form, "when");
            const r = await sendChallenge({ opponent_id: opponent.id, proposed_at: when ? new Date(when).toISOString() : undefined, message: text(form, "note") || undefined });
            await qc.invalidateQueries({ queryKey: ["challenges"] });
            setSent(r.emailed ? "Challenge sent · alerted in-app and by email" : "Challenge sent · alerted in-app");
          }}>
            <Field label="Suggested time (optional)"><input name="when" type="datetime-local" data-testid="challenge-when" /></Field>
            <Field label="Note (optional)" hint="Shown in the app only"><input name="note" maxLength={280} placeholder="Court 3 on Saturday?" data-testid="challenge-note" /></Field>
          </Form>
        </div>
      )}
    </>
  );
}

function ReportChallenge({ id }: { id: string }) {
  const qc = useQueryClient();
  return (
    <Form label="Send score for confirmation" className="pr-challenge-report" onSubmit={async (form) => {
      const winner = text(form, "winner");
      await reportChallenge(id, { score_text: text(form, "score") || undefined, outcome: "completed", match_format: text(form, "format"), i_won: winner ? winner === "me" : undefined });
      await qc.invalidateQueries();
    }}>
      <Field label="Score (your games first)"><input name="score" placeholder="6-3 6-4" maxLength={120} data-testid={`challenge-score-${id}`} /></Field>
      <Field label="Winner"><select name="winner" defaultValue=""><option value="">From the score</option><option value="me">I won</option><option value="them">They won</option></select></Field>
      <Field label="Format"><select name="format" defaultValue="best_of_3"><option value="best_of_3">Best of 3 sets</option><option value="pro_set">Pro set</option><option value="one_set">One set</option><option value="tiebreak">Match tiebreak only</option></select></Field>
    </Form>
  );
}

const statusText: Record<ApiChallenge["status"], string> = { pending: "Waiting for reply", accepted: "Accepted · play and report", declined: "Declined", cancelled: "Cancelled", completed: "Score reported" };
const resultText: Record<string, string> = { finalized: "Rated", disputed: "Score disputed", cancelled: "Result voided" };
const label = (c: ApiChallenge) => (c.status === "completed" && c.result_status && resultText[c.result_status]) || statusText[c.status];

function ChallengeRow({ c, highlight, me }: { c: ApiChallenge; highlight: boolean; me?: string }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  return (
    <li id={`challenge-${c.id}`} className={`pr-challenge${highlight ? " highlight" : ""}`} data-testid={`challenge-${c.id}`}>
      <div className="pr-challenge-head">
        <span>
          <small>{c.direction === "sent" ? "You challenged" : "Challenged by"}</small>
          <Link to={`/players/${c.opponent.user_id}`}><strong>{c.opponent.display_name}</strong></Link>
          {c.proposed_at && <small>Suggested {date(c.proposed_at, "America/Chicago", true)}</small>}
        </span>
        <span className={`pr-challenge-status ${c.status}`} data-testid={`challenge-status-${c.id}`}>{label(c)}</span>
      </div>
      {c.message && <p className="pr-challenge-note">“{c.message}”</p>}
      <div className="row">
        {c.status === "pending" && c.direction === "received" && (
          <>
            <Action variant="primary" onClick={async () => { await respondChallenge(c.id, "accept"); await refresh(); }}><span data-testid={`challenge-accept-${c.id}`}>Accept</span></Action>
            <Action onClick={async () => { await respondChallenge(c.id, "decline"); await refresh(); }}><span data-testid={`challenge-decline-${c.id}`}>Decline</span></Action>
          </>
        )}
        {(c.status === "accepted" || (c.status === "pending" && c.direction === "sent")) && (
          <Action onClick={async () => { await cancelChallenge(c.id); await refresh(); }}><span data-testid={`challenge-cancel-${c.id}`}>Cancel</span></Action>
        )}
        {me && <Link className="text-link" to={`/players/${me}/vs/${c.opponent.user_id}`} data-testid={`challenge-h2h-${c.id}`}>Head to head</Link>}
      </div>
      {(c.status === "accepted" || (c.status === "completed" && c.result_status === "cancelled")) && <ReportChallenge id={c.id} />}
      {c.status === "completed" && c.result_status === "reported" && <small className="muted">Waiting for the other player to confirm the score.</small>}
      {c.status === "completed" && c.result_status === "disputed" && <small className="muted">An organizer will review the disputed score. If it is voided you can report it again here.</small>}
    </li>
  );
}

/** Challenges sent and received, newest first; `?challenge=` (from the email or alert) is scrolled to and highlighted. */
export function Challenges() {
  const { user } = useSession();
  const [params] = useSearchParams();
  const focus = params.get("challenge");
  const q = useQuery({ queryKey: ["challenges"], queryFn: listChallenges });
  const rows = (q.data ?? []).filter((c, i) => ["pending", "accepted"].includes(c.status) || c.id === focus || i < 6);
  useEffect(() => {
    if (focus && q.data) document.getElementById(`challenge-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus, q.data]);
  return (
    <Panel title="Challenges">
      {q.isLoading ? <p role="status">Loading challenges…</p> : !rows.length ? (
        <div data-testid="challenges-empty"><Empty title="No challenges yet" icon={<Swords size={28} />}>Pick a fair match below and send a challenge.</Empty></div>
      ) : (
        <ul className="pr-challenges" data-testid="challenges-list">{rows.map((c) => <ChallengeRow key={c.id} c={c} highlight={c.id === focus} me={user?.uid} />)}</ul>
      )}
    </Panel>
  );
}
