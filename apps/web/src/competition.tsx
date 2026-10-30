import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addApiEntry,
  awardApiWalkover,
  cancelApiLadderChallenge,
  confirmApiCompetitionResult,
  createApiLadderChallenge,
  disputeApiCompetitionResult,
  generateApiDraw,
  generateApiSwissRound,
  listApiCompetitionMatches,
  listApiEntries,
  listApiPlayerStandings,
  submitApiCompetitionResult,
  withdrawApiEntry,
  type ApiCompetitionMatch,
  type ApiEntry,
} from "./api";
import { useSession } from "./context";
import { Action, Badge, Empty, Field, Form, Panel, number, text } from "./ui";
import type { Entity } from "@pprc/shared";

const roundLabel = (name: string) => {
  const numbered = /^(winners|losers)_round_(\d+)$/.exec(name);
  if (numbered) return `${numbered[1] === "winners" ? "Winners" : "Losers"} round ${numbered[2]}`;
  if (name.startsWith("round_")) return `Round ${name.slice(6)}`;
  if (name === "grand_final") return "Grand final";
  if (name === "grand_final_reset") return "Grand final reset";
  return name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
};
// Winners bracket, then losers bracket, then the grand final.
const bracketRank = (name: string) => (name.startsWith("losers_") ? 1 : name.startsWith("grand_") ? 2 : 0);
const entryLabel = (entry: ApiEntry) => (entry.partner_user_id ? `${entry.display_name} / ${entry.partner_name ?? entry.partner_user_id}` : entry.display_name);
const rule = (division: Entity, key: string) => (division.rules as Record<string, unknown> | undefined)?.[key];

/**
 * Standings, bracket, Swiss rounds or ladder for an individual-format division.
 * Organizers get entry management, draw generation, score entry and walkovers; players get
 * entry, challenges and report/confirm.
 */
export function CompetitionBoard({ division, staff, open = false }: { division: Entity; staff: boolean; open?: boolean }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const id = division.id;
  const format = String(division.format);
  const doubles = rule(division, "entryType") === "doubles";
  const refresh = () => qc.invalidateQueries({ queryKey: ["competition", id] });
  const entries = useQuery({ queryKey: ["competition", id, "entries"], queryFn: () => listApiEntries(id) });
  const matches = useQuery({ queryKey: ["competition", id, "matches"], queryFn: () => listApiCompetitionMatches(id) });
  const tabled = format === "round_robin" || format === "swiss";
  const standings = useQuery({ queryKey: ["competition", id, "standings"], queryFn: () => listApiPlayerStandings(id), enabled: tabled });
  const active = (entries.data ?? []).filter((entry) => entry.status === "active");
  const labels = new Map<string, string>();
  for (const entry of entries.data ?? []) labels.set(entry.user_id, entryLabel(entry));
  const name = (userId: string | null) => (userId ? labels.get(userId) ?? userId : "TBD");
  const mine = active.find((entry) => entry.user_id === user?.uid || entry.partner_user_id === user?.uid);
  const allMatches = matches.data ?? [];
  const drawn = allMatches.length > 0;
  const lastRound = Math.max(0, ...allMatches.map((match) => match.round_number));
  const swissTotal = Number(rule(division, "swissRounds") ?? 0);
  const roundDone = allMatches.filter((match) => match.round_number === lastRound).every((match) => ["finalized", "bye"].includes(match.status));
  if (entries.isLoading || matches.isLoading) return <p role="status">Loading competition…</p>;
  if (entries.error || matches.error) return <p role="alert" className="error">{(entries.error ?? matches.error)?.message}</p>;
  const partnerFields = doubles && (
    <>
      <Field label="Partner Firebase UID"><input name="partnerId" required /></Field>
      <Field label="Partner name"><input name="partnerName" /></Field>
    </>
  );
  const partnerInput = (form: FormData) => (doubles ? { partner_user_id: text(form, "partnerId"), partner_name: text(form, "partnerName") || undefined } : {});
  return (
    <>
      {format === "ladder" ? (
        <LadderPanel division={division} entries={active} matches={allMatches} mine={mine} name={name} staff={staff} refresh={refresh} />
      ) : (
        <>
          {tabled && (
            <Panel title="Standings">
              {(standings.data ?? []).length === 0 ? <Empty title="No players yet" /> : (
                <div className="table-scroll"><table><thead><tr><th>{doubles ? "Pair" : "Player"}</th><th>P</th><th>W</th><th>L</th><th>Points</th></tr></thead><tbody>
                  {(standings.data ?? []).map((row) => <tr key={row.subject_id}><td>{name(row.subject_id)}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.points}</td></tr>)}
                </tbody></table></div>
              )}
              {format === "swiss" && drawn && <p className="hint">Round {lastRound} of {swissTotal || "?"}</p>}
            </Panel>
          )}
          <MatchList title={format === "round_robin" ? "Schedule and results" : format === "swiss" ? "Rounds" : "Bracket"} matches={allMatches} name={name} staff={staff} refresh={refresh} />
        </>
      )}
      <Panel title={`${doubles ? "Pairs" : "Players"} (${active.length}/${String(division.capacity)})`}>
        {active.length === 0 && <Empty title="Nobody has entered yet" />}
        {active.map((entry) => (
          <div className="division-row" key={entry.id}>
            <span><strong>{entryLabel(entry)}</strong>{entry.seed ? ` · seed ${entry.seed}` : ""}{entry.rating != null ? ` · UTR ${entry.rating}` : ""}</span>
            {(staff || entry.user_id === user?.uid || entry.partner_user_id === user?.uid) && (
              <Action onClick={async () => {
                const warning = drawn && format !== "ladder" ? " Their unfinished matches will be awarded to the opponents as walkovers." : "";
                if (!window.confirm(`Withdraw ${entryLabel(entry)}?${warning}`)) return;
                await withdrawApiEntry(entry.id);
                await refresh();
              }}>Withdraw</Action>
            )}
          </div>
        ))}
        {!staff && !mine && open && (!drawn || format === "ladder") && (
          <Form label={doubles ? "Enter with a partner" : "Enter this division"} onSubmit={async (form) => { await addApiEntry(id, partnerInput(form)); await refresh(); }}>
            {partnerFields}
          </Form>
        )}
      </Panel>
      {staff && (
        <Panel title="Organizer tools">
          {(!drawn || format === "ladder") && (
            <Form label={doubles ? "Add pair" : "Add player"} onSubmit={async (form) => {
              await addApiEntry(id, {
                user_id: text(form, "userId"),
                display_name: text(form, "displayName") || undefined,
                rating: form.get("rating") ? number(form, "rating") : undefined,
                seed: form.get("seed") ? number(form, "seed") : undefined,
                ...partnerInput(form),
              });
              await refresh();
            }}>
              <div className="form-grid">
                <Field label="Player Firebase UID"><input name="userId" required /></Field>
                <Field label="Display name"><input name="displayName" /></Field>
                {partnerFields}
                <Field label="UTR"><input name="rating" type="number" min="0" max="20" step="0.01" /></Field>
                <Field label="Seed" hint="Leave blank to seed by UTR"><input name="seed" type="number" min="1" /></Field>
              </div>
            </Form>
          )}
          {!drawn && (
            <Action variant="primary" onClick={async () => { await generateApiDraw(id); await refresh(); }}>
              {format === "ladder" ? "Seed ladder by seed and UTR" : format === "round_robin" ? "Generate round-robin schedule" : format === "swiss" ? "Generate round 1" : "Generate bracket"}
            </Action>
          )}
          {format === "swiss" && drawn && lastRound < swissTotal && (
            <Action variant="primary" disabled={!roundDone} onClick={async () => { await generateApiSwissRound(id); await refresh(); }}>
              {roundDone ? `Generate round ${lastRound + 1}` : "Finish round " + lastRound + " to continue"}
            </Action>
          )}
          {drawn && format !== "ladder" && format !== "swiss" && <p className="notice">The draw is locked. Withdrawals and no-shows are handled as walkovers.</p>}
        </Panel>
      )}
    </>
  );
}

function LadderPanel({ division, entries, matches, mine, name, staff, refresh }: {
  division: Entity; entries: ApiEntry[]; matches: ApiCompetitionMatch[]; mine?: ApiEntry; name: (id: string | null) => string; staff: boolean; refresh: () => Promise<unknown>;
}) {
  const reach = Number(rule(division, "challengeRange") ?? 3);
  const expiry = Number(rule(division, "challengeExpiryDays") ?? 0);
  const forfeit = rule(division, "challengeExpiryAction") === "defender_forfeits";
  const open = matches.filter((match) => match.status !== "finalized");
  const busy = (userId: string) => open.some((match) => match.player_one_id === userId || match.player_two_id === userId);
  const canChallenge = (entry: ApiEntry) =>
    !!mine && entry.rank != null && mine.rank != null && entry.rank < mine.rank && mine.rank - entry.rank <= reach && !busy(mine.user_id) && !busy(entry.user_id);
  return (
    <>
      <Panel title="Ladder">
        {entries.length === 0 ? <Empty title="The ladder is empty" /> : (
          <div className="table-scroll"><table><thead><tr><th>Rank</th><th>{rule(division, "entryType") === "doubles" ? "Pair" : "Player"}</th><th /></tr></thead><tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.rank}</td>
                <td>{entryLabel(entry)}{entry.id === mine?.id ? " (you)" : ""}</td>
                <td>{canChallenge(entry) && <Action onClick={async () => { await createApiLadderChallenge(division.id, entry.user_id); await refresh(); }}>Challenge</Action>}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        <p className="hint">
          You can challenge entries up to {reach} places above you. Win to take their rank.
          {expiry > 0 && ` Unplayed challenges ${forfeit ? "are awarded to the challenger" : "are cancelled"} after ${expiry} days; a score that is not confirmed in that time stands.`}
        </p>
      </Panel>
      <MatchList title="Challenges" matches={matches} name={name} staff={staff} refresh={refresh} cancellable />
    </>
  );
}

function MatchList({ title, matches, name, staff, refresh, cancellable = false }: {
  title: string; matches: ApiCompetitionMatch[]; name: (id: string | null) => string; staff: boolean; refresh: () => Promise<unknown>; cancellable?: boolean;
}) {
  const { user } = useSession();
  if (matches.length === 0) return <Panel title={title}><Empty title="Nothing scheduled yet" /></Panel>;
  const groups = new Map<string, ApiCompetitionMatch[]>();
  for (const match of matches) groups.set(match.round_name, [...(groups.get(match.round_name) ?? []), match]);
  const ordered = [...groups.entries()].sort(([nameA, a], [nameB, b]) => bracketRank(nameA) - bracketRank(nameB) || a[0].round_number - b[0].round_number);
  return (
    <Panel title={title}>
      {ordered.map(([roundName, items]) => (
        <section key={roundName}>
          <h3>{roundLabel(roundName)}</h3>
          {items.map((match) => {
            const me = user?.uid ?? "";
            const ready = match.status === "scheduled" || match.status === "reported";
            return (
              <div className="score-record" key={match.id}>
                <p>
                  <strong className={match.winner_id === match.player_one_id ? "winner" : ""}>{name(match.player_one_id)}</strong> vs{" "}
                  <strong className={match.winner_id === match.player_two_id ? "winner" : ""}>{match.player_two_id ? name(match.player_two_id) : "—"}</strong>{" "}
                  <Badge>{match.status === "bye" ? "Bye" : match.status}</Badge>
                  {match.score_one != null && ` ${match.score_one}–${match.score_two}${match.score_text ? ` (${match.score_text})` : ""}`}
                  {match.score_one == null && match.score_text && ` (${match.score_text})`}
                </p>
                {match.status === "reported" && me !== match.reported_by && !staff && (
                  <div className="button-row">
                    <Action variant="primary" onClick={async () => { await confirmApiCompetitionResult(match.id); await refresh(); }}>Confirm score</Action>
                    <Action onClick={async () => { const reason = window.prompt("Why is this score wrong?"); if (reason && reason.length >= 5) { await disputeApiCompetitionResult(match.id, reason); await refresh(); } }}>Dispute</Action>
                  </div>
                )}
                {match.status === "reported" && me === match.reported_by && <p className="hint">Waiting for your opponent to confirm.</p>}
                {(staff ? ready || (match.status === "finalized" && !cancellable) : match.status === "scheduled") && (
                  <Form label={match.status === "finalized" ? "Correct score" : staff ? "Finalize score" : "Report score"} onSubmit={async (form) => {
                    await submitApiCompetitionResult(match.id, {
                      score_one: number(form, "scoreOne"), score_two: number(form, "scoreTwo"),
                      score_text: text(form, "scoreText") || undefined,
                      audit_reason: match.status === "finalized" ? text(form, "reason") : undefined,
                    });
                    await refresh();
                  }}>
                    <div className="form-grid">
                      <Field label={`${name(match.player_one_id)} score`}><input name="scoreOne" type="number" min="0" max="99" required /></Field>
                      <Field label={`${name(match.player_two_id)} score`}><input name="scoreTwo" type="number" min="0" max="99" required /></Field>
                      <Field label="Set scores (optional)"><input name="scoreText" placeholder="6-3 4-6 10-7" maxLength={120} /></Field>
                      {match.status === "finalized" && <Field label="Correction reason"><input name="reason" minLength={5} required /></Field>}
                    </div>
                  </Form>
                )}
                {staff && ready && match.player_one_id && match.player_two_id && (
                  <div className="button-row">
                    {[match.player_one_id, match.player_two_id].map((winner) => (
                      <Action key={winner} onClick={async () => {
                        const reason = window.prompt(`Walkover for ${name(winner)}: reason (no-show, injury, withdrawal)`);
                        if (!reason || reason.length < 5) return;
                        await awardApiWalkover(match.id, winner, reason);
                        await refresh();
                      }}>Walkover to {name(winner)}</Action>
                    ))}
                  </div>
                )}
                {cancellable && match.status !== "finalized" && (staff || me === match.player_one_id) && (
                  <Action onClick={async () => { await cancelApiLadderChallenge(match.id); await refresh(); }}>Cancel challenge</Action>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </Panel>
  );
}
