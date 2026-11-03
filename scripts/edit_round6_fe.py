import os

os.chdir("/app/apps/web/src")


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:80])
        s = s.replace(a, b, 1)
    open(p, "w").write(s)


edit("api.ts", [
    ('status: "pending" | "accepted" | "declined" | "cancelled" | "completed"; direction', 'status: "pending" | "accepted" | "declined" | "cancelled" | "completed" | "expired"; awaiting_you: boolean; expires_at: string | null; direction'),
    ('export const getHeadToHead =', '''export const proposeChallengeTime = (id: string, proposed_at: string, message?: string) => apiRequest<ApiChallenge>(`/v1/challenges/${id}/propose`, { method: "POST", body: JSON.stringify({ proposed_at, message }) });
export type ApiChallengeSettings = { challenge_expiry_days: number; reminder_after_days: number };
export const getChallengeSettings = () => apiRequest<ApiChallengeSettings>(`/v1/clubs/${apiClubId}/challenge-settings`);
export const saveChallengeSettings = (days: number) => apiRequest<ApiChallengeSettings>(`/v1/clubs/${apiClubId}/challenge-settings`, { method: "PUT", body: JSON.stringify({ challenge_expiry_days: days }) });
export const getPublicHeadToHead = (a: string, b: string) => publicApiRequest<ApiHeadToHead>(`/v1/public/clubs/${apiClubSlug}/head-to-head/${encodeURIComponent(a)}/${encodeURIComponent(b)}`);
export const getHeadToHead ='''),
])

edit("challenges.tsx", [
    ('import { cancelChallenge, listChallenges, reportChallenge, respondChallenge, sendChallenge, type ApiChallenge } from "./api";',
     'import { cancelChallenge, listChallenges, proposeChallengeTime, reportChallenge, respondChallenge, sendChallenge, type ApiChallenge } from "./api";'),
    ('''const statusText: Record<ApiChallenge["status"], string> = { pending: "Waiting for reply",''', '''function SuggestTime({ id }: { id: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  if (!open) return <button className="button secondary" onClick={() => setOpen(true)} data-testid={`challenge-suggest-${id}`}>Suggest another time</button>;
  return (
    <div className="pr-challenge-form" data-testid={`challenge-suggest-form-${id}`}>
      <Form label="Send new time" onSubmit={async (form) => {
        await proposeChallengeTime(id, new Date(text(form, "when")).toISOString(), text(form, "note") || undefined);
        setOpen(false);
        await qc.invalidateQueries({ queryKey: ["challenges"] });
      }}>
        <Field label="New time"><input name="when" type="datetime-local" required data-testid={`challenge-suggest-when-${id}`} /></Field>
        <Field label="Note (optional)" hint="Shown in the app only"><input name="note" maxLength={280} placeholder="Sunday works better" /></Field>
      </Form>
    </div>
  );
}

const statusText: Record<ApiChallenge["status"], string> = { expired: "Expired", pending: "Waiting for reply",'''),
    ('''const label = (c: ApiChallenge) => (c.status === "completed" && c.result_status && resultText[c.result_status]) || statusText[c.status];''',
     '''const label = (c: ApiChallenge) => (c.status === "completed" && c.result_status && resultText[c.result_status]) || (c.awaiting_you ? "Your turn" : statusText[c.status]);'''),
    ('''          {c.proposed_at && <small>Suggested {date(c.proposed_at, "America/Chicago", true)}</small>}''', '''          {c.proposed_at && <small data-testid={`challenge-time-${c.id}`}>Suggested {date(c.proposed_at, "America/Chicago", true)}</small>}
          {c.expires_at && <small>Expires {date(c.expires_at, "America/Chicago", true)} if unanswered</small>}'''),
    ('''        {c.status === "pending" && c.direction === "received" && (
          <>
            <Action variant="primary" onClick={async () => { await respondChallenge(c.id, "accept"); await refresh(); }}><span data-testid={`challenge-accept-${c.id}`}>Accept</span></Action>
            <Action onClick={async () => { await respondChallenge(c.id, "decline"); await refresh(); }}><span data-testid={`challenge-decline-${c.id}`}>Decline</span></Action>
          </>
        )}''', '''        {c.awaiting_you && (
          <>
            <Action variant="primary" onClick={async () => { await respondChallenge(c.id, "accept"); await refresh(); }}><span data-testid={`challenge-accept-${c.id}`}>{c.direction === "sent" ? "Accept new time" : "Accept"}</span></Action>
            <Action onClick={async () => { await respondChallenge(c.id, "decline"); await refresh(); }}><span data-testid={`challenge-decline-${c.id}`}>Decline</span></Action>
          </>
        )}'''),
    ('''      {(c.status === "accepted" || (c.status === "completed" && c.result_status === "cancelled")) && <ReportChallenge id={c.id} />}''',
     '''      {c.awaiting_you && <SuggestTime id={c.id} />}
      {(c.status === "accepted" || (c.status === "completed" && c.result_status === "cancelled")) && <ReportChallenge id={c.id} />}'''),
])

edit("members-admin.tsx", [
    ('import { listMembers, sendRecapsNow, setMemberRole } from "./api";', 'import { getChallengeSettings, listMembers, saveChallengeSettings, sendRecapsNow, setMemberRole } from "./api";'),
    ('''export function MembersRoles() {''', '''function ChallengeSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["challenge-settings"], queryFn: getChallengeSettings });
  const [message, setMessage] = useState("");
  if (!q.data) return null;
  return (
    <Panel title="Challenge settings">
      <p className="hint">Players get one friendly reminder (in-app and email) after {q.data.reminder_after_days} quiet days. Unanswered challenges then close automatically.</p>
      <form className="pr-preview-bar" onSubmit={async (e) => {
        e.preventDefault();
        setMessage("");
        try {
          const days = Number(new FormData(e.currentTarget).get("days"));
          await saveChallengeSettings(days);
          await qc.invalidateQueries({ queryKey: ["challenge-settings"] });
          setMessage(`Saved · challenges expire after ${days} days`);
        } catch (error) {
          setMessage((error as Error).message);
        }
      }}>
        <label htmlFor="expiry-days">Expire after</label>
        <input id="expiry-days" name="days" type="number" min={3} max={30} defaultValue={q.data.challenge_expiry_days} key={q.data.challenge_expiry_days} className="pr-days-input" data-testid="challenge-expiry-input" /> days
        <button className="button secondary" data-testid="challenge-expiry-save">Save</button>
      </form>
      {message && <p role="status" data-testid="challenge-expiry-status">{message}</p>}
    </Panel>
  );
}

export function MembersRoles() {'''),
    ('      <EmailPreview />\n', '      <EmailPreview />\n      <ChallengeSettings />\n'),
])

edit("milestones.tsx", [("function wrap(ctx", "export function wrap(ctx")])

edit("App.tsx", [('<Route path="/players/:a/vs/:b" element={<RequireUser><RivalryPage /></RequireUser>} />', '<Route path="/players/:a/vs/:b" element={<RivalryPage />} />')])

edit("rivalry.tsx", [
    ('import { getHeadToHead, photoUrl, type ApiH2HChange, type ApiH2HPlayer, type RatingKind } from "./api";',
     'import { getHeadToHead, getPublicHeadToHead, photoUrl, type ApiH2HChange, type ApiH2HPlayer, type RatingKind } from "./api";\nimport { RivalryShare } from "./rivalry-share";'),
    ('const q = useQuery({ queryKey: ["h2h", a, b], queryFn: () => getHeadToHead(a, b) });', 'const q = useQuery({ queryKey: ["h2h", a, b, user?.uid], queryFn: () => (user ? getHeadToHead(a, b) : getPublicHeadToHead(a, b)), enabled: !loading });'),
    ('const { user } = useSession();', 'const { user, loading } = useSession();'),
    ('if (q.isLoading) return', 'if (loading || q.isLoading) return'),
    ('One of these players is private or not in the club.', '{user ? "One of these players is private or not in the club." : "Both players need a public profile for this link to work. Sign in to see it as a club member."}'),
    ('''        <Side p={q.data.b} kind={kind} align="right" />
      </section>''', '''        <Side p={q.data.b} kind={kind} align="right" />
      </section>
      <RivalryShare data={q.data} kind={kind} />'''),
])
print("ok")
