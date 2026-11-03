import os

os.chdir("/app/apps/web/src")


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b, 1)
    open(p, "w").write(s)


edit("api.ts", [
    ('proposed_at: string | null; message: string | null; created_at: string;', 'proposed_at: string | null; court: string | null; message: string | null; created_at: string;'),
    ('export const sendChallenge = (input: { opponent_id: string; proposed_at?: string; message?: string })', 'export const sendChallenge = (input: { opponent_id: string; proposed_at?: string; message?: string; court?: string })'),
    ('''export const proposeChallengeTime = (id: string, proposed_at: string, message?: string) => apiRequest<ApiChallenge>(`/v1/challenges/${id}/propose`, { method: "POST", body: JSON.stringify({ proposed_at, message }) });''',
     '''export const proposeChallengeTime = (id: string, proposed_at: string, message?: string, court?: string) => apiRequest<ApiChallenge>(`/v1/challenges/${id}/propose`, { method: "POST", body: JSON.stringify({ proposed_at, message, court }) });
export type ApiRivalry = { a: ApiSidePlayer; b: ApiSidePlayer; a_wins: number; b_wins: number; meetings: number; last_played_at: string };
export type ApiRivalries = { kind: RatingKind; most_played: ApiRivalry[]; closest: ApiRivalry[]; one_sided: ApiRivalry[] };
export const listRivalries = (kind: RatingKind) => apiRequest<ApiRivalries>(`/v1/clubs/${apiClubId}/rivalries?kind=${kind}`);'''),
])
edit("challenges.tsx", [
    ('import { Swords } from "lucide-react";', 'import { CalendarPlus, MapPin, Swords } from "lucide-react";'),
    ('''            const r = await sendChallenge({ opponent_id: opponent.id, proposed_at: when ? new Date(when).toISOString() : undefined, message: text(form, "note") || undefined });''',
     '''            const r = await sendChallenge({ opponent_id: opponent.id, proposed_at: when ? new Date(when).toISOString() : undefined, court: text(form, "court") || undefined, message: text(form, "note") || undefined });'''),
    ('''            <Field label="Suggested time (optional)"><input name="when" type="datetime-local" data-testid="challenge-when" /></Field>''',
     '''            <Field label="Suggested time (optional)"><input name="when" type="datetime-local" data-testid="challenge-when" /></Field>
            <Field label="Court (optional)"><input name="court" maxLength={80} placeholder="PPRC Court 3" data-testid="challenge-court" /></Field>'''),
    ('''function SuggestTime({ id }: { id: string }) {''', '''/** Google Calendar "add event" link for an agreed match (90 minutes). */
function calendarLink(c: ApiChallenge, myName?: string) {
  const start = new Date(c.proposed_at!);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\\.\\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `PPRC singles: ${myName ? `${myName} vs ` : "vs "}${c.opponent.display_name}`,
    dates: `${stamp(start)}/${stamp(new Date(start.getTime() + 90 * 60000))}`,
    details: `PPRC challenge match. Report the score in the PPRC app afterwards: ${window.location.origin}/me/matches?challenge=${c.id}`,
    ...(c.court ? { location: c.court } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function SuggestTime({ id, court }: { id: string; court?: string | null }) {'''),
    ('''        await proposeChallengeTime(id, new Date(text(form, "when")).toISOString(), text(form, "note") || undefined);''',
     '''        await proposeChallengeTime(id, new Date(text(form, "when")).toISOString(), text(form, "note") || undefined, text(form, "court"));'''),
    ('''        <Field label="New time"><input name="when" type="datetime-local" required data-testid={`challenge-suggest-when-${id}`} /></Field>''',
     '''        <Field label="New time"><input name="when" type="datetime-local" required data-testid={`challenge-suggest-when-${id}`} /></Field>
        <Field label="Court"><input name="court" maxLength={80} defaultValue={court ?? ""} placeholder="PPRC Court 3" data-testid={`challenge-suggest-court-${id}`} /></Field>'''),
    ('''          {c.expires_at && <small>''', '''          {c.court && <small className="pr-challenge-court" data-testid={`challenge-court-${c.id}`}><MapPin size={12} /> {c.court}</small>}
          {c.expires_at && <small>'''),
    ('''        {me && <Link className="text-link" to={`/players/${me}/vs/${c.opponent.user_id}`} data-testid={`challenge-h2h-${c.id}`}>Head to head</Link>}''',
     '''        {c.status === "accepted" && c.proposed_at && (
          <a className="button secondary small" href={calendarLink(c, myName)} target="_blank" rel="noopener noreferrer" data-testid={`challenge-calendar-${c.id}`}><CalendarPlus size={14} /> Add to Google Calendar</a>
        )}
        {me && <Link className="text-link" to={`/players/${me}/vs/${c.opponent.user_id}`} data-testid={`challenge-h2h-${c.id}`}>Head to head</Link>}'''),
    ('''      {c.awaiting_you && <SuggestTime id={c.id} />}''', '''      {c.awaiting_you && <SuggestTime id={c.id} court={c.court} />}'''),
    ('''function ChallengeRow({ c, highlight, me }: { c: ApiChallenge; highlight: boolean; me?: string }) {''', '''function ChallengeRow({ c, highlight, me, myName }: { c: ApiChallenge; highlight: boolean; me?: string; myName?: string }) {'''),
    ('''<ChallengeRow key={c.id} c={c} highlight={c.id === focus} me={user?.uid} />''', '''<ChallengeRow key={c.id} c={c} highlight={c.id === focus} me={user?.uid} myName={user?.displayName ?? undefined} />'''),
])
edit("players.tsx", [
    ('import { Challenges } from "./challenges";', 'import { Challenges } from "./challenges";\nimport { RivalryBoard } from "./rivalries";'),
    ('''          <p className="hint">P = provisional (fewer than 5 verified matches). PPRC Rating is PPRC's own rating, formula pprc-rating-1.0.</p>
        </>
      )}''', '''          <p className="hint">P = provisional (fewer than 5 verified matches). PPRC Rating is PPRC's own rating, formula pprc-rating-1.0.</p>
        </>
      )}
      {member && scope === "club" && <RivalryBoard kind={kind} />}'''),
])
open("players.css", "a").write('''
.pr-challenge-court { display: inline-flex; align-items: center; gap: 4px; }
.pr-rivalries { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.pr-rivalries li { display: grid; grid-template-columns: 28px 1fr auto auto; align-items: center; gap: 12px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 14px; background: #fff; transition: border-color 0.2s; }
.pr-rivalries li:hover { border-color: #9fb5c8; }
.pr-riv-rank { font: 700 14px "DM Mono", monospace; color: var(--muted); }
.pr-riv-names { min-width: 0; overflow-wrap: anywhere; }
.pr-riv-names span { color: var(--muted); font-size: 13px; margin: 0 4px; }
.pr-riv-record { font: 700 20px/1 "Space Grotesk", sans-serif; color: var(--navy); font-variant-numeric: tabular-nums; }
.pr-rivalries small { color: var(--muted); font-size: 12px; }
@media (max-width: 600px) {
  .pr-rivalries li { grid-template-columns: 24px 1fr auto; }
  .pr-rivalries small { grid-column: 2 / -1; }
}
''')
print("ok")
