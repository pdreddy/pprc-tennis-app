import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, MapPin, Swords } from "lucide-react";
import { cancelChallenge, listChallenges, proposeChallengeTime, reportChallenge, respondChallenge, sendChallenge, type ApiChallenge } from "./api";
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
            const r = await sendChallenge({ opponent_id: opponent.id, proposed_at: when ? new Date(when).toISOString() : undefined, court: text(form, "court") || undefined, message: text(form, "note") || undefined });
            await qc.invalidateQueries({ queryKey: ["challenges"] });
            setSent(r.emailed ? "Challenge sent · alerted in-app and by email" : "Challenge sent · alerted in-app");
          }}>
            <Field label="Suggested time (optional)"><input name="when" type="datetime-local" data-testid="challenge-when" /></Field>
            <Field label="Court (optional)"><input name="court" maxLength={80} placeholder="PPRC Court 3" data-testid="challenge-court" /></Field>
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

/** Google Calendar "add event" link for an agreed match (90 minutes). */
function calendarLink(c: ApiChallenge, myName?: string) {
  const start = new Date(c.proposed_at!);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `PPRC singles: ${myName ? `${myName} vs ` : "vs "}${c.opponent.display_name}`,
    dates: `${stamp(start)}/${stamp(new Date(start.getTime() + 90 * 60000))}`,
    details: `PPRC challenge match. Report the score in the PPRC app afterwards: ${window.location.origin}/me/matches?challenge=${c.id}`,
    ...(c.court ? { location: c.court } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function SuggestTime({ id, court }: { id: string; court?: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  if (!open) return <button className="button secondary" onClick={() => setOpen(true)} data-testid={`challenge-suggest-${id}`}>Suggest another time</button>;
  return (
    <div className="pr-challenge-form" data-testid={`challenge-suggest-form-${id}`}>
      <Form label="Send new time" onSubmit={async (form) => {
        await proposeChallengeTime(id, new Date(text(form, "when")).toISOString(), text(form, "note") || undefined, text(form, "court"));
        setOpen(false);
        await qc.invalidateQueries({ queryKey: ["challenges"] });
      }}>
        <Field label="New time"><input name="when" type="datetime-local" required data-testid={`challenge-suggest-when-${id}`} /></Field>
        <Field label="Court"><input name="court" maxLength={80} defaultValue={court ?? ""} placeholder="PPRC Court 3" data-testid={`challenge-suggest-court-${id}`} /></Field>
        <Field label="Note (optional)" hint="Shown in the app only"><input name="note" maxLength={280} placeholder="Sunday works better" /></Field>
      </Form>
    </div>
  );
}

const statusText: Record<ApiChallenge["status"], string> = { expired: "Expired", pending: "Waiting for reply", accepted: "Accepted · play and report", declined: "Declined", cancelled: "Cancelled", completed: "Score reported" };
const resultText: Record<string, string> = { finalized: "Rated", disputed: "Score disputed", cancelled: "Result voided" };
const label = (c: ApiChallenge) => (c.status === "completed" && c.result_status && resultText[c.result_status]) || (c.awaiting_you ? "Your turn" : statusText[c.status]);

function ChallengeRow({ c, highlight, me, myName }: { c: ApiChallenge; highlight: boolean; me?: string; myName?: string }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries();
  return (
    <li id={`challenge-${c.id}`} className={`pr-challenge${highlight ? " highlight" : ""}`} data-testid={`challenge-${c.id}`}>
      <div className="pr-challenge-head">
        <span>
          <small>{c.direction === "sent" ? "You challenged" : "Challenged by"}</small>
          <Link to={`/players/${c.opponent.user_id}`}><strong>{c.opponent.display_name}</strong></Link>
          {c.proposed_at && <small data-testid={`challenge-time-${c.id}`}>Suggested {date(c.proposed_at, "America/Chicago", true)}</small>}
          {c.court && <small className="pr-challenge-court" data-testid={`challenge-court-${c.id}`}><MapPin size={12} /> {c.court}</small>}
          {c.expires_at && <small>Expires {date(c.expires_at, "America/Chicago", true)} if unanswered</small>}
        </span>
        <span className={`pr-challenge-status ${c.status}`} data-testid={`challenge-status-${c.id}`}>{label(c)}</span>
      </div>
      {c.message && <p className="pr-challenge-note">“{c.message}”</p>}
      <div className="row">
        {c.awaiting_you && (
          <>
            <Action variant="primary" onClick={async () => { await respondChallenge(c.id, "accept"); await refresh(); }}><span data-testid={`challenge-accept-${c.id}`}>{c.direction === "sent" ? "Accept new time" : "Accept"}</span></Action>
            <Action onClick={async () => { await respondChallenge(c.id, "decline"); await refresh(); }}><span data-testid={`challenge-decline-${c.id}`}>Decline</span></Action>
          </>
        )}
        {(c.status === "accepted" || (c.status === "pending" && c.direction === "sent")) && (
          <Action onClick={async () => { await cancelChallenge(c.id); await refresh(); }}><span data-testid={`challenge-cancel-${c.id}`}>Cancel</span></Action>
        )}
        {c.status === "accepted" && c.proposed_at && (
          <a className="button secondary small" href={calendarLink(c, myName)} target="_blank" rel="noopener noreferrer" data-testid={`challenge-calendar-${c.id}`}><CalendarPlus size={14} /> Add to Google Calendar</a>
        )}
        {me && <Link className="text-link" to={`/players/${me}/vs/${c.opponent.user_id}`} data-testid={`challenge-h2h-${c.id}`}>Head to head</Link>}
      </div>
      {c.awaiting_you && <SuggestTime id={c.id} court={c.court} />}
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
        <ul className="pr-challenges" data-testid="challenges-list">{rows.map((c) => <ChallengeRow key={c.id} c={c} highlight={c.id === focus} me={user?.uid} myName={user?.displayName ?? undefined} />)}</ul>
      )}
    </Panel>
  );
}
