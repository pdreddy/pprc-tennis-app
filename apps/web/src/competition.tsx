import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addApiEntry,
  cancelApiLadderChallenge,
  confirmApiCompetitionResult,
  createApiLadderChallenge,
  disputeApiCompetitionResult,
  generateApiDraw,
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

const roundLabel = (name: string) =>
  name.startsWith("round_") ? `Round ${name.slice(6)}` : name === "challenge" ? "Challenge" : name.replace(/^./, (c) => c.toUpperCase());

/**
 * Standings, bracket or ladder for an individual-format division.
 * Organizers get entry management, draw generation and score entry; players get challenge and report/confirm.
 */
export function CompetitionBoard({ division, staff }: { division: Entity; staff: boolean }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const id = division.id;
  const format = String(division.format);
  const refresh = () => qc.invalidateQueries({ queryKey: ["competition", id] });
  const entries = useQuery({ queryKey: ["competition", id, "entries"], queryFn: () => listApiEntries(id) });
  const matches = useQuery({ queryKey: ["competition", id, "matches"], queryFn: () => listApiCompetitionMatches(id) });
  const standings = useQuery({ queryKey: ["competition", id, "standings"], queryFn: () => listApiPlayerStandings(id), enabled: format === "round_robin" });
  const active = (entries.data ?? []).filter((entry) => entry.status === "active");
  const names = new Map((entries.data ?? []).map((entry) => [entry.user_id, entry.display_name]));
  const name = (userId: string | null) => (userId ? names.get(userId) ?? userId : "TBD");
  const mine = active.find((entry) => entry.user_id === user?.uid);
  const allMatches = matches.data ?? [];
  const drawn = allMatches.length > 0;
  if (entries.isLoading || matches.isLoading) return <p role="status">Loading competition…</p>;
  if (entries.error || matches.error) return <p role="alert" className="error">{(entries.error ?? matches.error)?.message}</p>;
  return (
    <>
      {format === "ladder" ? (
        <LadderPanel division={division} entries={active} matches={allMatches} mine={mine} name={name} staff={staff} refresh={refresh} />
      ) : (
        <>
          {format === "round_robin" && (
            <Panel title="Standings">
              {(standings.data ?? []).length === 0 ? <Empty title="No players yet" /> : (
                <div className="table-scroll"><table><thead><tr><th>Player</th><th>P</th><th>W</th><th>L</th><th>Points</th></tr></thead><tbody>
                  {(standings.data ?? []).map((row) => <tr key={row.subject_id}><td>{row.display_name}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.points}</td></tr>)}
                </tbody></table></div>
              )}
            </Panel>
          )}
          <MatchList title={format === "single_elimination" ? "Bracket" : "Schedule and results"} matches={allMatches} name={name} staff={staff} refresh={refresh} />
        </>
      )}
      <Panel title={`Players (${active.length}/${String(division.capacity)})`}>
        {active.length === 0 && <Empty title="No players have entered yet" />}
        {active.map((entry) => (
          <div className="division-row" key={entry.id}>
            <span><strong>{entry.display_name}</strong>{entry.seed ? ` · seed ${entry.seed}` : ""}{entry.rating != null ? ` · UTR ${entry.rating}` : ""}</span>
            {(staff || entry.user_id === user?.uid) && (format === "ladder" || !drawn) && (
              <Action onClick={async () => { await withdrawApiEntry(entry.id); await refresh(); }}>Withdraw</Action>
            )}
          </div>
        ))}
      </Panel>
      {staff && (
        <Panel title="Organizer tools">
          {!drawn && format !== "ladder" && (
            <Form label="Add player" onSubmit={async (form) => {
              await addApiEntry(id, {
                user_id: text(form, "userId"),
                display_name: text(form, "displayName") || undefined,
                rating: form.get("rating") ? number(form, "rating") : undefined,
                seed: form.get("seed") ? number(form, "seed") : undefined,
              });
              await refresh();
            }}>
              <div className="form-grid">
                <Field label="Player Firebase UID"><input name="userId" required /></Field>
                <Field label="Display name"><input name="displayName" /></Field>
                <Field label="UTR"><input name="rating" type="number" min="0" max="20" step="0.01" /></Field>
                <Field label="Seed" hint="Leave blank to seed by UTR"><input name="seed" type="number" min="1" /></Field>
              </div>
            </Form>
          )}
          {format === "ladder" && (
            <Form label="Add player to ladder" onSubmit={async (form) => {
              await addApiEntry(id, { user_id: text(form, "userId"), display_name: text(form, "displayName") || undefined });
              await refresh();
            }}>
              <div className="form-grid">
                <Field label="Player Firebase UID"><input name="userId" required /></Field>
                <Field label="Display name"><input name="displayName" /></Field>
              </div>
            </Form>
          )}
          {!drawn && (
            <Action variant="primary" onClick={async () => { await generateApiDraw(id); await refresh(); }}>
              {format === "ladder" ? "Seed ladder by seed and UTR" : format === "round_robin" ? "Generate round-robin schedule" : "Generate bracket"}
            </Action>
          )}
          {drawn && format !== "ladder" && <p className="notice">The draw is locked. Late changes need a walkover recorded by an organizer.</p>}
        </Panel>
      )}
    </>
  );
}

function LadderPanel({ division, entries, matches, mine, name, staff, refresh }: {
  division: Entity; entries: ApiEntry[]; matches: ApiCompetitionMatch[]; mine?: ApiEntry; name: (id: string | null) => string; staff: boolean; refresh: () => Promise<unknown>;
}) {
  const reach = Number((division.rules as Record<string, unknown> | undefined)?.challengeRange ?? 3);
  const open = matches.filter((match) => match.status !== "finalized");
  const busy = (userId: string) => open.some((match) => match.player_one_id === userId || match.player_two_id === userId);
  const canChallenge = (entry: ApiEntry) =>
    !!mine && entry.rank != null && mine.rank != null && entry.rank < mine.rank && mine.rank - entry.rank <= reach && !busy(mine.user_id) && !busy(entry.user_id);
  return (
    <>
      <Panel title="Ladder">
        {entries.length === 0 ? <Empty title="The ladder is empty" /> : (
          <div className="table-scroll"><table><thead><tr><th>Rank</th><th>Player</th><th /></tr></thead><tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.rank}</td>
                <td>{entry.display_name}{entry.id === mine?.id ? " (you)" : ""}</td>
                <td>{canChallenge(entry) && <Action onClick={async () => { await createApiLadderChallenge(division.id, entry.user_id); await refresh(); }}>Challenge</Action>}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
        <p className="hint">You can challenge players up to {reach} places above you. Win to take their rank.</p>
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
  const groups = new Map<number, ApiCompetitionMatch[]>();
  for (const match of matches) groups.set(match.round_number, [...(groups.get(match.round_number) ?? []), match]);
  return (
    <Panel title={title}>
      {[...groups.entries()].map(([round, items]) => (
        <section key={round}>
          <h3>{roundLabel(items[0].round_name)}</h3>
          {items.map((match) => {
            const me = user?.uid ?? "";
            const participant = me === match.player_one_id || me === match.player_two_id;
            const playable = match.status === "scheduled" || match.status === "reported" || (staff && match.status === "finalized" && !cancellable);
            return (
              <div className="score-record" key={match.id}>
                <p>
                  <strong className={match.winner_id === match.player_one_id ? "winner" : ""}>{name(match.player_one_id)}</strong> vs{" "}
                  <strong className={match.winner_id === match.player_two_id ? "winner" : ""}>{name(match.player_two_id)}</strong>{" "}
                  <Badge>{match.status === "bye" ? "Bye" : match.status}</Badge>
                  {match.score_one != null && ` ${match.score_one}–${match.score_two}${match.score_text ? ` (${match.score_text})` : ""}`}
                </p>
                {match.status === "reported" && me !== match.reported_by && participant && (
                  <div className="button-row">
                    <Action variant="primary" onClick={async () => { await confirmApiCompetitionResult(match.id); await refresh(); }}>Confirm score</Action>
                    <Action onClick={async () => { const reason = window.prompt("Why is this score wrong?"); if (reason && reason.length >= 5) { await disputeApiCompetitionResult(match.id, reason); await refresh(); } }}>Dispute</Action>
                  </div>
                )}
                {match.status === "reported" && me === match.reported_by && <p className="hint">Waiting for your opponent to confirm.</p>}
                {playable && (staff || (participant && match.status === "scheduled")) && (
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
