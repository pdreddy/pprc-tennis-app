import os

os.chdir("/app/apps/web/src")


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:60])
        s = s.replace(a, b, 1)
    open(p, "w").write(s)


edit("fair-matches.tsx", [
    ('import { Tabs } from "./components";', 'import { Tabs } from "./components";\nimport { ChallengeButton } from "./challenges";\nimport { useSession } from "./context";'),
    ('  const [spread, setSpread] = useState("0.5");', '  const [spread, setSpread] = useState("0.5");\n  const { user } = useSession();'),
    ('<small>{o.city ?? "PPRC"} · Head to head {o.head_to_head.wins}-{o.head_to_head.losses}</small>',
     '<small>{o.city ?? "PPRC"} · <Link to={`/players/${user?.uid}/vs/${o.user_id}`} data-testid={`fair-match-h2h-${o.user_id}`}>Head to head {o.head_to_head.wins}-{o.head_to_head.losses}</Link></small>'),
    ('''              {onPick && kind === "singles" && <button className="button secondary small" onClick={() => onPick({ id: o.user_id, name: o.display_name })} data-testid={`fair-match-report-${o.user_id}`}>Report match</button>}''',
     '''              {onPick && kind === "singles" && (
                <span className="pr-fair-actions">
                  <ChallengeButton opponent={{ id: o.user_id, name: o.display_name }} />
                  <button className="button secondary small" onClick={() => onPick({ id: o.user_id, name: o.display_name })} data-testid={`fair-match-report-${o.user_id}`}>Report match</button>
                </span>
              )}'''),
])
edit("players.tsx", [
    ('import { FairMatches } from "./fair-matches";', 'import { FairMatches } from "./fair-matches";\nimport { Challenges } from "./challenges";'),
    ('''  return <div className="page"><PlayerDetailView detail={q.data} /></div>;''',
     '''  return (
    <div className="page">
      <PlayerDetailView detail={q.data}>
        {user && user.uid !== userId && <Link className="button secondary small" to={`/players/${user.uid}/vs/${userId}`} data-testid="player-h2h-link">Head to head with you</Link>}
      </PlayerDetailView>
    </div>
  );'''),
    ('''              weekly_recap: form.get("weeklyRecap") === "on",''', '''              weekly_recap: form.get("weeklyRecap") === "on",
              monthly_digest: form.get("monthlyDigest") === "on",'''),
    ('''data-testid="weekly-recap-checkbox" /> Email me a weekly rating recap (Mondays){detail.preferences?.email ? ` to ${detail.preferences.email}` : ""}</label>''',
     '''data-testid="weekly-recap-checkbox" /> Email me a weekly rating recap (Mondays){detail.preferences?.email ? ` to ${detail.preferences.email}` : ""}</label>
              <label className="check"><input name="monthlyDigest" type="checkbox" defaultChecked={onboarding || !!detail.preferences?.monthly_digest} data-testid="monthly-digest-checkbox" /> Email me the monthly club leaderboard (1st of each month)</label>'''),
    ('''      <FairMatches onPick=''', '''      <Challenges />
      <FairMatches onPick='''),
])
edit("members-admin.tsx", [
    ('import { Empty, Panel } from "./ui";', 'import { Empty, Panel } from "./ui";\nimport { EmailPreview } from "./email-preview";'),
    ('      <RecapSender />\n', '      <RecapSender />\n      <EmailPreview />\n'),
])
edit("App.tsx", [
    ('const LadderPage = lazy(', 'const RivalryPage = lazy(() => import("./rivalry").then((m) => ({ default: m.RivalryPage })));\nconst LadderPage = lazy('),
    ('            <Route path="/players/:userId" element={<PlayerPage />} />', '            <Route path="/players/:userId" element={<PlayerPage />} />\n            <Route path="/players/:a/vs/:b" element={<RequireUser><RivalryPage /></RequireUser>} />'),
])
css = open("/app/scripts/round5.css").read()
open("players.css", "a").write(css)
print("ok")
