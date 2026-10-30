import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addApiEntry,
  advanceApiGroups,
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
  type ApiPlayerStanding,
} from "./api";
import { useSession } from "./context";
import { Action, Empty, Field, Form, Panel, number, text } from "./ui";
import { Callout, ConfirmAction, DataTable, FieldGrid, MatchCard, PromptAction, SectionTitle, StatGrid, type Column } from "./components";
import type { Entity } from "@pprc/shared";

const roundLabel = (name: string) => {
  const numbered = /^(winners|losers)_round_(\d+)$/.exec(name);
  if (numbered) return `${numbered[1] === "winners" ? "Winners" : "Losers"} round ${numbered[2]}`;
  if (name.startsWith("round_")) return `Round ${name.slice(6)}`;
  const group = /^group_(.+)$/.exec(name);
  if (group) return `Group ${group[1]}`;
  if (name === "grand_final") return "Grand final";
  if (name === "grand_final_reset") return "Grand final reset";
  return name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
};
// Winners bracket, then losers bracket, then the grand final.
const bracketRank = (name: string) => (name.startsWith("group_") ? -1 : name.startsWith("losers_") ? 1 : name.startsWith("grand_") ? 2 : 0);
const entryLabel = (entry: ApiEntry) => (entry.partner_user_id ? `${entry.display_name} / ${entry.partner_name ?? entry.partner_user_id}` : entry.display_name);
const rule = (division: Entity, key: string) => (division.rules as Record<string, unknown> | undefined)?.[key];

const standingColumns = (label: string, name: (id: string | null) => string): Column<ApiPlayerStanding>[] => [
  { key: "player", header: label, cell: (row) => name(row.subject_id) },
  { key: "p", header: "P", numeric: true, cell: (row) => row.played },
  { key: "w", header: "W", numeric: true, cell: (row) => row.wins },
  { key: "l", header: "L", numeric: true, cell: (row) => row.losses },
  { key: "pts", header: "Pts", numeric: true, cell: (row) => <strong>{row.points}</strong> },
];

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
  const tabled = format === "round_robin" || format === "swiss" || format === "groups_knockout";
  const grouped = format === "groups_knockout";
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
  const finished = allMatches.filter((match) => match.status === "finalized").length;
  const partnerFields = doubles && (
    <>
      <Field label="Partner Firebase UID"><input name="partnerId" required /></Field>
      <Field label="Partner name"><input name="partnerName" /></Field>
    </>
  );
  const partnerInput = (form: FormData) => (doubles ? { partner_user_id: text(form, "partnerId"), partner_name: text(form, "partnerName") || undefined } : {});
  return (
    <>
      <StatGrid items={[
        { label: doubles ? "Pairs" : "Players", value: `${active.length}/${String(division.capacity)}` },
        { label: "Matches played", value: `${finished}/${allMatches.filter((match) => match.status !== "bye").length}` },
        { label: "Status", value: drawn ? "Under way" : "Not drawn" },
      ]} />
      {format === "ladder" ? (
        <LadderPanel division={division} entries={active} matches={allMatches} mine={mine} name={name} staff={staff} refresh={refresh} />
      ) : (
        <>
          {tabled && (
            <Panel title="Standings">
              {(standings.data ?? []).length === 0 ? <Empty title="No players yet" /> : (
                [...new Set((standings.data ?? []).map((row) => row.group ?? ""))].map((group) => (
                  <DataTable
                    key={group}
                    caption={grouped ? `Group ${group}` : undefined}
                    columns={standingColumns(doubles ? "Pair" : "Player", name)}
                    rows={(standings.data ?? []).filter((row) => (row.group ?? "") === group)}
                    rowKey={(row) => row.subject_id}
                  />
                ))
              )}
              {format === "swiss" && drawn && <p className="hint">Round {lastRound} of {swissTotal || "?"}</p>}
            </Panel>
          )}
          <MatchList title={format === "round_robin" ? "Schedule and results" : format === "swiss" ? "Rounds" : format === "groups_knockout" ? "Group matches and knockout" : "Bracket"} matches={allMatches} name={name} staff={staff} refresh={refresh} />
        </>
      )}
      <Panel title={`${doubles ? "Pairs" : "Players"} (${active.length}/${String(division.capacity)})`}>
        {active.length === 0 && <Empty title="Nobody has entered yet" />}
        {active.map((entry) => (
          <div className="division-row" key={entry.id}>
            <span><strong>{entryLabel(entry)}</strong>{entry.group_label ? ` · group ${entry.group_label}` : ""}{entry.seed ? ` · seed ${entry.seed}` : ""}{entry.rating != null ? ` · UTR ${entry.rating}` : ""}</span>
            {(staff || entry.user_id === user?.uid || entry.partner_user_id === user?.uid) && (
              <ConfirmAction
                label="Withdraw"
                title={`Withdraw ${entryLabel(entry)}?`}
                message={drawn && format !== "ladder" ? "Their unfinished matches will be awarded to the opponents as walkovers." : "They will be removed from this division."}
                confirmLabel="Withdraw"
                onConfirm={async () => { await withdrawApiEntry(entry.id); await refresh(); }}
              />
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
              <FieldGrid>
                <Field label="Player Firebase UID"><input name="userId" required /></Field>
                <Field label="Display name"><input name="displayName" /></Field>
                {partnerFields}
                <Field label="UTR"><input name="rating" type="number" min="0" max="20" step="0.01" /></Field>
                <Field label="Seed" hint="Leave blank to seed by UTR"><input name="seed" type="number" min="1" /></Field>
              </FieldGrid>
            </Form>
          )}
          {!drawn && (
            <Action variant="primary" onClick={async () => { await generateApiDraw(id); await refresh(); }}>
              {format === "ladder" ? "Seed ladder by seed and UTR" : format === "round_robin" ? "Generate round-robin schedule" : format === "swiss" ? "Generate round 1" : format === "groups_knockout" ? "Snake-draw groups and schedule matches" : "Generate bracket"}
            </Action>
          )}
          {format === "swiss" && drawn && lastRound < swissTotal && (
            <Action variant="primary" disabled={!roundDone} onClick={async () => { await generateApiSwissRound(id); await refresh(); }}>
              {roundDone ? `Generate round ${lastRound + 1}` : "Finish round " + lastRound + " to continue"}
            </Action>
          )}
          {grouped && drawn && !allMatches.some((match) => !match.round_name.startsWith("group_")) && (
            <Action variant="primary" disabled={!allMatches.every((match) => match.status === "finalized")} onClick={async () => { await advanceApiGroups(id); await refresh(); }}>
              {allMatches.every((match) => match.status === "finalized") ? `Advance top ${String(rule(division, "advancePerGroup") ?? 2)} per group to knockout` : "Finish all group matches to continue"}
            </Action>
          )}
          {drawn && format !== "ladder" && format !== "swiss" && <Callout>The draw is locked. Withdrawals and no-shows are handled as walkovers.</Callout>}
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
        <DataTable
          empty={<Empty title="The ladder is empty" />}
          rows={entries}
          rowKey={(entry) => entry.id}
          columns={[
            { key: "rank", header: "Rank", className: "rank", cell: (entry) => entry.rank },
            { key: "player", header: rule(division, "entryType") === "doubles" ? "Pair" : "Player", cell: (entry) => <>{entryLabel(entry)}{entry.id === mine?.id ? " (you)" : ""}</> },
            { key: "action", header: "", cell: (entry) => canChallenge(entry) && <Action onClick={async () => { await createApiLadderChallenge(division.id, entry.user_id); await refresh(); }}>Challenge</Action> },
          ]}
        />
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
  const me = user?.uid ?? "";
  return (
    <Panel title={title}>
      {ordered.map(([roundName, items]) => (
        <section key={roundName}>
          <SectionTitle>{roundLabel(roundName)}</SectionTitle>
          {items.map((match) => {
            const ready = match.status === "scheduled" || match.status === "reported";
            const sides = [match.player_one_id, match.player_two_id] as const;
            const note = match.status === "reported" && me === match.reported_by
              ? "Waiting for your opponent to confirm."
              : match.score_text;
            return (
              <MatchCard
                key={match.id}
                label={match.starts_at ? new Date(match.starts_at).toLocaleDateString() : `Match ${match.position + 1}`}
                status={match.status}
                home={{ name: name(sides[0]), score: match.score_one, winner: !!match.winner_id && match.winner_id === sides[0] }}
                away={{ name: sides[1] ? name(sides[1]) : "—", score: match.score_two, winner: !!match.winner_id && match.winner_id === sides[1] }}
                note={note}
              >
                {match.status === "reported" && me !== match.reported_by && !staff && (
                  <div className="pp-match-actions">
                    <Action variant="primary" onClick={async () => { await confirmApiCompetitionResult(match.id); await refresh(); }}>Confirm score</Action>
                    <PromptAction label="Dispute" title="Dispute this score" promptLabel="Why is this score wrong?" submitLabel="Send dispute" onSubmit={async (reason) => { await disputeApiCompetitionResult(match.id, reason); await refresh(); }} />
                  </div>
                )}
                {(staff ? ready || (match.status === "finalized" && !cancellable) : match.status === "scheduled") && (
                  <Form label={match.status === "finalized" ? "Correct score" : staff ? "Finalize score" : "Report score"} onSubmit={async (form) => {
                    await submitApiCompetitionResult(match.id, {
                      score_one: number(form, "scoreOne"), score_two: number(form, "scoreTwo"),
                      score_text: text(form, "scoreText") || undefined,
                      audit_reason: match.status === "finalized" ? text(form, "reason") : undefined,
                    });
                    await refresh();
                  }}>
                    <FieldGrid>
                      <Field label={`${name(sides[0])} score`}><input name="scoreOne" type="number" min="0" max="99" required /></Field>
                      <Field label={`${name(sides[1])} score`}><input name="scoreTwo" type="number" min="0" max="99" required /></Field>
                      <Field label="Set scores (optional)"><input name="scoreText" placeholder="6-3 4-6 10-7" maxLength={120} /></Field>
                      {match.status === "finalized" && <Field label="Correction reason"><input name="reason" minLength={5} required /></Field>}
                    </FieldGrid>
                  </Form>
                )}
                <div className="pp-match-actions">
                  {staff && ready && sides[0] && sides[1] && sides.map((winner) => (
                    <PromptAction
                      key={winner}
                      label={`Walkover: ${name(winner)}`}
                      title={`Award walkover to ${name(winner)}`}
                      promptLabel="Reason (no-show, injury, withdrawal)"
                      submitLabel="Award walkover"
                      onSubmit={async (reason) => { await awardApiWalkover(match.id, winner, reason); await refresh(); }}
                    />
                  ))}
                  {cancellable && match.status !== "finalized" && (staff || me === match.player_one_id) && (
                    <ConfirmAction label="Cancel challenge" title="Cancel this challenge?" message="The challenge will be removed and both players can challenge again." confirmLabel="Cancel challenge" onConfirm={async () => { await cancelApiLadderChallenge(match.id); await refresh(); }} />
                  )}
                </div>
              </MatchCard>
            );
          })}
        </section>
      ))}
    </Panel>
  );
}
