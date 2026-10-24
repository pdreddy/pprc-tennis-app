import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ladderRulesSchema,
  competitionRules,
  type LadderRules,
  type LadderStanding,
} from "@pprc/shared";
import { useSession, useList, useAction } from "./context";
import { useTriace, TriaceTournament, EncounterCard } from "./teams";
import {
  Panel,
  Field,
  Form,
  Action,
  Badge,
  Empty,
  date,
  text,
  number,
} from "./ui";

const numericRules: [keyof LadderRules, string][] = [
  ["responseHours", "Response deadline (hours)"],
  ["completionDays", "Accepted match window (days)"],
  ["normalReach", "Normal upward challenge range"],
  ["streakReach", "Winning streak upward range"],
  ["streakThreshold", "Wins needed for streak benefits"],
  ["topDownPositions", "Top positions allowed downward challenges"],
  ["downwardReach", "Downward challenge range"],
  ["rematchDays", "Minimum days before rematch"],
  ["maximumMeetings", "Maximum meetings per season"],
  ["earlyWeeks", "Early-season restricted weeks"],
  ["earlyMaximumMeetings", "Maximum meetings during early weeks"],
  ["winPoints", "Played win points"],
  ["lossPoints", "Played loss points"],
  ["walkoverPoints", "Walkover points (no bonuses)"],
  ["streakBonus", "Streak bonus"],
  ["upsetBonus", "Upset bonus"],
  ["upsetGap", "Positions needed for upset bonus"],
  ["challengeBonus", "Successful upward challenge bonus"],
  ["defenseBonus", "Successful defense bonus"],
  ["freeDeclines", "Free declines per season"],
  ["declinePenalty", "Subsequent decline point penalty"],
  ["strikesForDrop", "Strikes before position drop"],
  ["strikeDrop", "Strike position drop"],
  ["inactivityWeeks", "Inactive weeks before drop"],
  ["inactivityDrop", "Inactivity position drop"],
  ["setGames", "Games to win a set"],
  ["playoffMinimumPlayed", "Minimum played matches for playoffs"],
  ["playoffGapHours", "Hours after freeze before playoffs"],
  ["playoffWindowDays", "Playoff scheduling window (days)"],
];
const booleans: [keyof LadderRules, string][] = [
  ["requireReferences", "Require supplied UTR reference values"],
  ["requireVerified", "Require admin-verified references"],
  ["membersOnly", "Require club membership"],
  [
    "walkoversCountForRematch",
    "Count walkovers toward opponent meeting limits",
  ],
  ["finalSetTiebreak", "Allow deciding match tiebreak"],
  ["noAd", "Use no-ad scoring"],
  ["policyConfirmed", "I reviewed and confirm the ladder season policy"],
];
export function LadderTournament({
  eventId,
  adminMode = false,
}: {
  eventId: string;
  adminMode?: boolean;
}) {
  const d = useTriace(eventId),
    { user } = useSession(),
    call = useAction(),
    qc = useQueryClient(),
    [tab, setTab] = useState("Standings");
  const operator = d.admin || d.support,
    filters: [string, any, any][] = [
      ["eventId", "==", eventId],
      ...(!operator
        ? [
            ["participantIds", "array-contains", user?.uid ?? "guest"] as [
              string,
              any,
              any,
            ],
          ]
        : []),
    ];
  const challenges = useList("ladderChallenges", filters, !!d.event && !!user),
    ledger = useList("ladderLedger", filters, !!d.event && !!user);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void qc.invalidateQueries({
        predicate: (q) => JSON.stringify(q.queryKey).includes(eventId),
      });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [qc, eventId]);
  const run = (action: string, data: any = {}) =>
      call("ladder", { eventId, action, ...data }),
    teamRun = (action: string, data: any = {}) =>
      call("teamCompetition", { eventId, action, ...data });
  if (d.loading) return <p role="status">Loading ladder season…</p>;
  if (d.error || d.teamError || challenges.error || ledger.error)
    return (
      <p role="alert" className="error">
        {(d.error ?? d.teamError ?? challenges.error ?? ledger.error)?.message}
      </p>
    );
  if (!d.event) return <Empty title="Ladder season not found" />;
  const event = d.event,
    r = ladderRulesSchema.parse(event.ladderRules),
    meta = event.ladderState ?? {},
    standings: LadderStanding[] = meta.standings ?? [],
    myTeams = d.teams.filter((t) => t.captainId === user?.uid && !t.withdrawn),
    name = (id: string) => d.teams.find((t) => t.id === id)?.name ?? "Entrant",
    managed = adminMode && d.admin;
  return (
    <div className={adminMode ? "ladder-workspace" : "page ladder-workspace"}>
      <Link className="text-link" to={adminMode ? "/admin/events" : "/events"}>
        ← Event calendar
      </Link>
      <section className="triace-hero">
        <div>
          <p className="eyebrow">
            PPRC SPORTS ELITE · {r.entryKind.toUpperCase()} LADDER
          </p>
          <Badge>{event.status}</Badge>
          <h1>{event.name}</h1>
          <p>
            {event.location} · {date(event.startDate, event.timezone)}–
            {date(event.endDate, event.timezone)} · {event.timezone}
          </p>
          <p>Challenge. Compete. Climb.</p>
        </div>
      </section>
      {meta.frozen && (
        <Panel
          title={
            meta.pendingReview
              ? "Final rankings frozen for review"
              : "Season champions"
          }
        >
          {meta.pendingReview ? (
            <p>
              Unverified or disputed results require organizer review before
              champions are declared.
            </p>
          ) : (
            <>
              <p>
                Ladder Champion:{" "}
                <strong>{name(meta.ladderChampionTeamId)}</strong>
              </p>
              <p>Runner-up: {name(meta.ladderRunnerUpTeamId)}</p>
              <p>
                Points Champion:{" "}
                <strong>
                  {meta.pointsChampionTeamId
                    ? name(meta.pointsChampionTeamId)
                    : "Awaiting organizer tiebreak decision"}
                </strong>
              </p>
            </>
          )}
        </Panel>
      )}
      {meta.reviewHold && (
        <p className="notice">
          Organizer review is open. Original score versions and ranking
          decisions remain in the audit history.
        </p>
      )}
      {managed && (
        <Panel title="Ladder season operations">
          <div className="button-row">
            {event.status === "Draft" && (
              <Action onClick={() => call("publishEvent", { eventId })}>
                Publish ladder season
              </Action>
            )}
            {!meta.started && event.status !== "Draft" && (
              <Action variant="primary" onClick={() => run("start")}>
                Start approved season
              </Action>
            )}
            {meta.started && !meta.frozen && (
              <Action onClick={() => run("tick")}>
                Process deadlines & weekly close
              </Action>
            )}
            {meta.started && !meta.frozen && (
              <Action onClick={() => run("close")}>
                Freeze final rankings
              </Action>
            )}
            {!!r.playoffQualifiers &&
              meta.frozen &&
              !meta.pendingReview &&
              !d.encounters.some((e) => e.phase === "playoffs") && (
                <Action onClick={() => run("generatePlayoffs")}>
                  Generate ladder playoffs
                </Action>
              )}
            {d.encounters.some(
              (e) => e.phase === "playoffs" && !e.scheduledAt && !e.winner,
            ) && (
              <Action onClick={() => teamRun("generateTeamSchedule")}>
                Schedule ladder playoffs
              </Action>
            )}
          </div>
          <p className="muted">
            Start after registration closes. Sunday 11:59 PM closes each week.
            Acceptance closes {r.completionDays} days before the final freeze;
            invitations close another {r.responseHours} hours earlier.
          </p>
        </Panel>
      )}
      <nav className="tabs" aria-label="Ladder sections">
        {[
          "Standings",
          "Challenges",
          "Entries & playoffs",
          "Season rules",
          ...(managed ? ["Organizer review"] : []),
        ].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === "Standings" && (
        <Panel title="Ladder standings">
          {!standings.length ? (
            <Empty title="Season not started">
              Approved entries will be seeded by the organizer using supplied
              UTR references.
            </Empty>
          ) : (
            <div className="table-scroll">
              <table data-testid="ladder-standings">
                <thead>
                  <tr>
                    {[
                      "Position",
                      "Entry",
                      "Points",
                      "Played",
                      "Won",
                      "Lost",
                      "Streak",
                      "Strikes",
                    ].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s) => (
                    <tr key={s.teamId} data-testid={`standing-${s.teamId}`}>
                      <td>#{s.position}</td>
                      <td>{name(s.teamId)}</td>
                      <td>{s.points}</td>
                      <td>{s.played}</td>
                      <td>{s.wins}</td>
                      <td>{s.losses}</td>
                      <td>{s.streak}</td>
                      <td>{s.strikes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p>
            Positions determine the Ladder Champion. Season points determine a
            separate Points Champion. Only verified results affect standings.
            Walkovers award {r.walkoverPoints} points without bonuses or
            played-match activity.
          </p>
        </Panel>
      )}
      {tab === "Challenges" && (
        <>
          {!user && (
            <Panel title="Join the ladder">
              <Link className="button primary" to="/signin">
                Sign in to enter and challenge
              </Link>
            </Panel>
          )}
          {meta.started &&
            !meta.frozen &&
            !meta.reviewHold &&
            myTeams.length > 0 && (
              <Panel title="Challenge another entrant">
                <Form
                  label="Send ladder challenge"
                  onSubmit={(f) =>
                    run("challenge", {
                      teamId: text(f, "teamId"),
                      opponentId: text(f, "opponentId"),
                    })
                  }
                >
                  <div className="form-grid">
                    <Field label="Your ladder entry">
                      <select name="teamId">
                        {myTeams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Opponent">
                      <select name="opponentId">
                        {standings
                          .filter(
                            (s) => !myTeams.some((t) => t.id === s.teamId),
                          )
                          .map((s) => (
                            <option key={s.teamId} value={s.teamId}>
                              #{s.position} · {name(s.teamId)}
                            </option>
                          ))}
                      </select>
                    </Field>
                  </div>
                  <p className="muted">
                    One active challenge per entry. Server checks range,
                    cooldown and opponent limits.
                  </p>
                </Form>
              </Panel>
            )}
          {(challenges.data ?? [])
            .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
            .map((ch) => {
              const own = myTeams.find((t) => ch.teamIds.includes(t.id)),
                game = d.encounters.find((e) => e.id === ch.encounterId);
              return (
                <Panel
                  key={ch.id}
                  title={`${name(ch.challengerId)} challenges ${name(ch.defenderId)}`}
                >
                  <Badge>{ch.state}</Badge>
                  <p>
                    {ch.state === "Pending"
                      ? `Respond by ${date(ch.responseDeadline, event.timezone, true)}`
                      : ch.completionDeadline
                        ? `Completion deadline: ${date(ch.completionDeadline, event.timezone, true)}`
                        : ch.decision}
                  </p>
                  {ch.state === "Pending" &&
                    own?.id === ch.defenderId &&
                    !meta.frozen && (
                      <div className="button-row">
                        <Action
                          variant="primary"
                          onClick={() =>
                            run("respond", {
                              challengeId: ch.id,
                              accepted: true,
                            })
                          }
                        >
                          Accept ladder challenge
                        </Action>
                        <Action
                          onClick={() =>
                            run("respond", {
                              challengeId: ch.id,
                              accepted: false,
                            })
                          }
                        >
                          Decline ladder challenge
                        </Action>
                      </div>
                    )}
                  {ch.confirmedSchedule && (
                    <p className="notice">
                      Agreed:{" "}
                      {date(
                        ch.confirmedSchedule.scheduledAt,
                        event.timezone,
                        true,
                      )}{" "}
                      · {ch.confirmedSchedule.location}
                    </p>
                  )}
                  {ch.scheduleProposal && (
                    <p>
                      Proposed:{" "}
                      {date(
                        ch.scheduleProposal.scheduledAt,
                        event.timezone,
                        true,
                      )}{" "}
                      · {ch.scheduleProposal.location}
                    </p>
                  )}
                  {ch.state === "Accepted" && own && !meta.frozen && (
                    <>
                      <Form
                        label="Propose match time"
                        onSubmit={(f) =>
                          run("proposeSchedule", {
                            challengeId: ch.id,
                            teamId: own.id,
                            scheduledAt: new Date(
                              text(f, "scheduledAt") + "Z",
                            ).toISOString(),
                            location: text(f, "location"),
                          })
                        }
                      >
                        <div className="form-grid">
                          <Field label="Proposed start (UTC)">
                            <input
                              name="scheduledAt"
                              type="datetime-local"
                              required
                            />
                          </Field>
                          <Field label="Match location">
                            <input name="location" required minLength={2} />
                          </Field>
                        </div>
                      </Form>
                      {ch.scheduleProposal &&
                        ch.scheduleProposal.teamId !== own.id && (
                          <Action
                            onClick={() =>
                              run("confirmSchedule", {
                                challengeId: ch.id,
                                teamId: own.id,
                              })
                            }
                          >
                            Confirm match time
                          </Action>
                        )}
                    </>
                  )}
                  {game && (
                    <EncounterCard
                      encounter={game}
                      data={d}
                      rules={competitionRules(event)}
                      run={teamRun}
                      adminMode={adminMode}
                    />
                  )}
                </Panel>
              );
            })}
          {!challenges.data?.length && (
            <Empty title="No challenges yet">
              Your active challenges and result confirmations appear here.
            </Empty>
          )}
        </>
      )}
      {tab === "Entries & playoffs" && (
        <TriaceTournament
          eventId={eventId}
          adminMode={adminMode}
          hideOperations
        />
      )}
      {tab === "Season rules" && (
        <>
          <Panel title="Season rulebook">
            <p>
              {r.entryKind === "doubles"
                ? "Two consenting players form a fixed pair for the entire season."
                : "One player per entry."}{" "}
              UTR is a supplied or admin-verified reference, independent of PPRC
              ladder results.
            </p>
            <p>
              Played win {r.winPoints}; loss {r.lossPoints}. Streak bonus{" "}
              {r.streakBonus} after {r.streakThreshold} wins; upset bonus{" "}
              {r.upsetBonus} for beating an opponent {r.upsetGap}+ positions
              above; upward challenge {r.challengeBonus}; defense{" "}
              {r.defenseBonus}.
            </p>
            <p>
              Normal upward range {r.normalReach}, streak range {r.streakReach}.
              Top {r.topDownPositions} may challenge down {r.downwardReach}.
              Rematches: {r.rematchDays} days apart, maximum {r.maximumMeetings}{" "}
              per season and {r.earlyMaximumMeetings} during weeks 1–
              {r.earlyWeeks}.
            </p>
            <p>
              Respond within {r.responseHours} hours; accepted matches get{" "}
              {r.completionDays} days, even across weekly close. First{" "}
              {r.freeDeclines} decline(s) free; later declines lose{" "}
              {r.declinePenalty} points and add a strike. At {r.strikesForDrop}{" "}
              strikes, drop {r.strikeDrop} places and reset strikes. Inactivity:{" "}
              {r.inactivityWeeks} weeks without a played match drops{" "}
              {r.inactivityDrop} places.
            </p>
            <p>
              Lower-ranked played winner swaps positions with the opponent.
              Walkover movement requires organizer approval. Retirements:{" "}
              {r.retirementTreatment}. Simultaneous inactivity penalties
              preserve relative order among affected entries.
            </p>
            <p>
              Points ties use match wins, successful upward challenges,
              head-to-head, then an audited organizer decision. Playoffs:{" "}
              {r.playoffQualifiers
                ? `${r.playoffQualifiers} qualifiers; ${r.playoffMinimumPlayed} played matches minimum; ${r.playoffSeeding} seeding; remaining seeding ties use frozen position.`
                : "Off"}
            </p>
          </Panel>
          {managed && !meta.started && !d.teams.length && (
            <LadderRulesEditor rules={r} run={run} />
          )}
          {managed && !meta.started && (
            <Panel title="Season calendar">
              <p>
                Enter UTC values. Season boundaries must be Monday midnight and
                Sunday 11:59 PM in {event.timezone}.
              </p>
              <Form
                label="Update ladder calendar"
                onSubmit={(f) =>
                  call("updateEvent", {
                    eventId,
                    event: {
                      startDate: new Date(
                        text(f, "startDate") + "Z",
                      ).toISOString(),
                      endDate: new Date(text(f, "endDate") + "Z").toISOString(),
                      registrationOpen: new Date(
                        text(f, "registrationOpen") + "Z",
                      ).toISOString(),
                      registrationClose: new Date(
                        text(f, "registrationClose") + "Z",
                      ).toISOString(),
                    },
                    reason: text(f, "reason"),
                  })
                }
              >
                <div className="form-grid">
                  {[
                    ["startDate", "Season start (UTC)"],
                    ["endDate", "Final Sunday close (UTC)"],
                    ["registrationOpen", "Entry opening (UTC)"],
                    ["registrationClose", "Entry closing (UTC)"],
                  ].map(([key, label]) => (
                    <Field key={key} label={label}>
                      <input
                        name={key}
                        type="datetime-local"
                        required
                        defaultValue={event[key].slice(0, 16)}
                      />
                    </Field>
                  ))}
                </div>
                <Reason label="Calendar change reason" />
              </Form>
            </Panel>
          )}
        </>
      )}
      {tab === "Organizer review" && managed && (
        <>
          {meta.frozen && !d.encounters.some((e) => e.phase === "playoffs") && (
            <Panel title="Reopen season review">
              <Form
                label="Reopen ladder review"
                onSubmit={(f) => run("reopen", { reason: text(f, "reason") })}
              >
                <Reason label="Season review reason" />
              </Form>
            </Panel>
          )}
          {meta.frozen &&
            !meta.pendingReview &&
            !meta.pointsChampionTeamId &&
            meta.pointsChampionCandidates?.length > 1 && (
              <Panel title="Points Champion tiebreak">
                <Form
                  label="Declare Points Champion"
                  onSubmit={(f) =>
                    run("decidePointsChampion", {
                      teamId: text(f, "teamId"),
                      reason: text(f, "reason"),
                    })
                  }
                >
                  <EntrySelect
                    ids={meta.pointsChampionCandidates}
                    nameFor={name}
                  />
                  <Reason label="Points Champion decision reason" />
                </Form>
              </Panel>
            )}
          {meta.started && !meta.frozen && (
            <>
              <Panel title="Inactivity exemption">
                <Form
                  label="Record inactivity exemption"
                  onSubmit={(f) =>
                    run("exemption", {
                      teamId: text(f, "teamId"),
                      fromWeek: number(f, "fromWeek"),
                      throughWeek: number(f, "throughWeek"),
                      reason: text(f, "reason"),
                    })
                  }
                >
                  <EntrySelect ids={meta.initialOrder} nameFor={name} />
                  <div className="form-grid">
                    <Field label="From week">
                      <input
                        type="number"
                        name="fromWeek"
                        min={1}
                        max={meta.weeks}
                        defaultValue={1}
                        required
                      />
                    </Field>
                    <Field label="Through week">
                      <input
                        type="number"
                        name="throughWeek"
                        min={1}
                        max={meta.weeks}
                        defaultValue={1}
                        required
                      />
                    </Field>
                  </div>
                  <Reason label="Exemption reason" />
                </Form>
              </Panel>
              <Panel title="Review penalties">
                {(ledger.data ?? [])
                  .filter((a) => ["decline", "week-close"].includes(a.kind))
                  .map((a) => (
                    <details key={a.id}>
                      <summary>
                        #{a.sequence} ·{" "}
                        {a.kind === "decline"
                          ? `${name(a.teamId)} decline`
                          : `Week ${a.week} inactivity close`}
                      </summary>
                      <Form
                        label="Save penalty waiver"
                        onSubmit={(f) =>
                          run(text(f, "waiverAction"), {
                            ledgerId: a.id,
                            teamId:
                              a.kind === "decline"
                                ? a.teamId
                                : text(f, "teamId"),
                            reason: text(f, "reason"),
                          })
                        }
                      >
                        {a.kind === "week-close" ? (
                          <>
                            <EntrySelect
                              ids={meta.initialOrder}
                              nameFor={name}
                            />
                            <input
                              type="hidden"
                              name="waiverAction"
                              value="waiveInactivity"
                            />
                          </>
                        ) : (
                          <Field label="Waiver type">
                            <select name="waiverAction">
                              <option value="waiveDecline">
                                Entire decline and penalty
                              </option>
                              <option value="waiveStrike">
                                Strike only; keep point penalty
                              </option>
                            </select>
                          </Field>
                        )}
                        <Reason label="Penalty waiver reason" />
                      </Form>
                    </details>
                  ))}
              </Panel>
              <Panel title="Challenge decisions">
                {(challenges.data ?? [])
                  .filter(
                    (ch) => ch.state !== "Declined" && ch.state !== "Cancelled",
                  )
                  .map((ch) => (
                    <details key={ch.id}>
                      <summary>
                        {name(ch.challengerId)} vs {name(ch.defenderId)} ·{" "}
                        {ch.state}
                      </summary>
                      {ch.state === "Final" && (
                        <Form
                          label="Record walkover movement decision"
                          onSubmit={(f) =>
                            run("walkoverMovement", {
                              challengeId: ch.id,
                              approved: f.get("approved") === "on",
                              reason: text(f, "reason"),
                            })
                          }
                        >
                          <label className="check">
                            <input
                              type="checkbox"
                              name="approved"
                              defaultChecked={ch.walkoverMovementApproved}
                            />
                            Approve position swap for verified walkover
                          </label>
                          <Reason label="Walkover movement reason" />
                        </Form>
                      )}
                      <Form
                        label="Cancel challenge as no contest"
                        onSubmit={(f) =>
                          run("cancelChallenge", {
                            challengeId: ch.id,
                            reason: text(f, "reason"),
                          })
                        }
                      >
                        <Reason label="No-contest decision reason" />
                      </Form>
                    </details>
                  ))}
              </Panel>
            </>
          )}
          <Panel title="Ladder audit history">
            <ol>
              {(ledger.data ?? [])
                .sort((a, b) => b.sequence - a.sequence)
                .map((a) => (
                  <li key={a.id}>
                    #{a.sequence} · {a.kind} ·{" "}
                    {date(a.recordedAt, event.timezone, true)}
                    {a.reason && ` · ${a.reason}`}
                  </li>
                ))}
            </ol>
          </Panel>
        </>
      )}
    </div>
  );
}
function Reason({ label }: { label: string }) {
  return (
    <Field label={label}>
      <input name="reason" minLength={5} maxLength={1000} required />
    </Field>
  );
}
function EntrySelect({
  ids,
  nameFor,
}: {
  ids: string[];
  nameFor: (id: string) => string;
}) {
  return (
    <Field label="Affected ladder entry">
      <select name="teamId">
        {ids.map((id) => (
          <option key={id} value={id}>
            {nameFor(id)}
          </option>
        ))}
      </select>
    </Field>
  );
}
function LadderRulesEditor({
  rules: r,
  run,
}: {
  rules: LadderRules;
  run: (action: string, data?: any) => Promise<any>;
}) {
  return (
    <Panel title="Configure ladder policy">
      <p>
        Review before publishing. Policy and fixed partnership settings lock
        when the first entry is created.
      </p>
      <Form
        label="Save ladder policy"
        onSubmit={(f) =>
          run("configure", {
            rules: {
              ...r,
              ...Object.fromEntries(
                numericRules.map(([k]) => [k, number(f, k)]),
              ),
              ...Object.fromEntries(
                booleans.map(([k]) => [k, f.get(k) === "on"]),
              ),
              entryKind: text(f, "entryKind"),
              retirementTreatment: text(f, "retirementTreatment"),
              rubberScoring: text(f, "rubberScoring"),
              setTiebreakAt:
                text(f, "setTiebreakAt") === ""
                  ? null
                  : number(f, "setTiebreakAt"),
              playoffQualifiers: number(f, "playoffQualifiers"),
              playoffSeeding: text(f, "playoffSeeding"),
            },
            reason: text(f, "reason"),
          })
        }
      >
        <div className="form-grid">
          <Field label="Ladder entry type">
            <select name="entryKind" defaultValue={r.entryKind}>
              <option value="singles">Singles player</option>
              <option value="doubles">Fixed consenting doubles pair</option>
            </select>
          </Field>
          {numericRules.map(([k, label]) => (
            <Field key={k} label={label}>
              <input
                name={k}
                type="number"
                min="0"
                max="336"
                defaultValue={Number(r[k])}
                required
              />
            </Field>
          ))}
          <Field label="Retirement treatment">
            <select
              name="retirementTreatment"
              defaultValue={r.retirementTreatment}
            >
              {["no-contest", "played", "walkover"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="Ladder match scoring">
            <select name="rubberScoring" defaultValue={r.rubberScoring}>
              <option value="one-set">One set</option>
              <option value="best-of-three">Best of three</option>
            </select>
          </Field>
          <Field label="Set tiebreak games (blank for none)">
            <input
              name="setTiebreakAt"
              type="number"
              min="0"
              max="8"
              defaultValue={r.setTiebreakAt ?? ""}
            />
          </Field>
          <Field label="Playoff qualifiers">
            <select name="playoffQualifiers" defaultValue={r.playoffQualifiers}>
              {[0, 2, 4, 8].map((n) => (
                <option key={n} value={n}>
                  {n || "Off"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Playoff seeding">
            <select name="playoffSeeding" defaultValue={r.playoffSeeding}>
              <option value="positions">Frozen ladder position</option>
              <option value="points">
                Points, wins, upward wins, frozen position
              </option>
            </select>
          </Field>
        </div>
        {booleans.map(([k, label]) => (
          <label className="check" key={k}>
            <input type="checkbox" name={k} defaultChecked={Boolean(r[k])} />
            {label}
          </label>
        ))}
        <Reason label="Ladder policy change reason" />
      </Form>
    </Panel>
  );
}
