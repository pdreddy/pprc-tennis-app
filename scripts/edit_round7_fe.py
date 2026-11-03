import os

os.chdir("/app/apps/web/src")


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:60])
        s = s.replace(a, b, 1)
    open(p, "w").write(s)


edit("api.ts", [
    ('export type ApiChallengeSettings = { challenge_expiry_days: number; reminder_after_days: number };', 'export type ApiChallengeSettings = { challenge_expiry_days: number; challenge_expiry_restarts: boolean; reminder_after_days: number };'),
    ('''export const saveChallengeSettings = (days: number) => apiRequest<ApiChallengeSettings>(`/v1/clubs/${apiClubId}/challenge-settings`, { method: "PUT", body: JSON.stringify({ challenge_expiry_days: days }) });''',
     '''export const saveChallengeSettings = (days: number, restarts: boolean) => apiRequest<ApiChallengeSettings>(`/v1/clubs/${apiClubId}/challenge-settings`, { method: "PUT", body: JSON.stringify({ challenge_expiry_days: days, challenge_expiry_restarts: restarts }) });'''),
])
edit("members-admin.tsx", [
    ('''          const days = Number(new FormData(e.currentTarget).get("days"));
          await saveChallengeSettings(days);''', '''          const form = new FormData(e.currentTarget);
          const days = Number(form.get("days"));
          const restarts = form.get("mode") === "restart";
          await saveChallengeSettings(days, restarts);'''),
    ('''setMessage(`Saved · challenges expire after ${days} days`);''', '''setMessage(`Saved · challenges expire ${days} days after ${restarts ? "the last suggested time" : "they were sent"}`);'''),
    ('''data-testid="challenge-expiry-input" /> days''', '''data-testid="challenge-expiry-input" /> days, counted from
        <select name="mode" aria-label="Count expiry from" defaultValue={q.data.challenge_expiry_restarts ? "restart" : "sent"} key={String(q.data.challenge_expiry_restarts)} onChange={() => setMessage("")} data-testid="challenge-expiry-mode">
          <option value="sent">when it was sent</option>
          <option value="restart">each new suggested time</option>
        </select>'''),
])
print("ok")
