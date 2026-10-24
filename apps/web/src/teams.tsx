import { useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, Shield, ChevronRight } from "lucide-react";
import { useSession, useAction, useEvent, useList } from "./context";
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
import {
  triaceRulesSchema,
  singlesParticipation,
  type Entity,
  type TriaceRules,
} from "@pprc/shared";

const unique = (...lists: (Entity[] | undefined)[]) => [
  ...new Map(lists.flatMap((l) => l ?? []).map((x) => [x.id, x])).values(),
];
export function useTriace(eventId: string) {
  const d = useEvent(eventId),
    { user } = useSession(),
    operator = d.admin || d.support;
  const filters: [string, any, any][] = [["eventId", "==", eventId]],
    enabled = !!d.event;
  const publicTeams = useList(
    "teams",
    [
      ...filters,
      ...(!operator ? [["published", "==", true] as [string, any, any]] : []),
    ],
    enabled,
  );
  const ownTeams = useList(
    "teams",
    [...filters, ["memberIds", "array-contains", user?.uid ?? "guest"]],
    enabled && !!user && !operator,
  );
  const invitations = useList(
    "invitations",
    [
      ...filters,
      ...(!operator
        ? [
            ["participantIds", "array-contains", user?.uid ?? "guest"] as [
              string,
              any,
              any,
            ],
          ]
        : []),
    ],
    enabled && !!user,
  );
  const groups = useList(
    "teamGroups",
    [
      ...filters,
      ...(!operator ? [["published", "==", true] as [string, any, any]] : []),
    ],
    enabled,
  );
  const encounters = useList(
    "teamEncounters",
    [
      ...filters,
      ...(!operator ? [["published", "==", true] as [string, any, any]] : []),
    ],
    enabled,
  );
  const lineups = useList(
    "lineups",
    [
      ...filters,
      ...(!operator ? [["published", "==", true] as [string, any, any]] : []),
    ],
    enabled,
  );
  const ownLineups = useList(
    "lineups",
    [...filters, ["memberIds", "array-contains", user?.uid ?? "guest"]],
    enabled && !!user && !operator,
  );
  const rubbers = useList(
    "rubbers",
    [
      ...filters,
      ...(!operator ? [["published", "==", true] as [string, any, any]] : []),
    ],
    enabled,
  );
  const results = useList(
    "rubberResults",
    [
      ...filters,
      ...(!operator
        ? ([
            ["state", "==", "Final"],
            ["published", "==", true],
          ] as [string, any, any][])
        : []),
    ],
    enabled,
  );
  const ownResults = useList(
    "rubberResults",
    [...filters, ["participantIds", "array-contains", user?.uid ?? "guest"]],
    enabled && !!user && !operator,
  );
  const disputes = useList(
    "disputes",
    [
      ...filters,
      ...(!operator
        ? [
            ["participantIds", "array-contains", user?.uid ?? "guest"] as [
              string,
              any,
              any,
            ],
          ]
        : []),
    ],
    enabled && !!user,
  );
  return {
    ...d,
    teams: unique(publicTeams.data, ownTeams.data),
    invitations: invitations.data ?? [],
    groups: groups.data ?? [],
    encounters: encounters.data ?? [],
    lineups: unique(lineups.data, ownLineups.data),
    rubbers: rubbers.data ?? [],
    rubberResults: unique(results.data, ownResults.data),
    disputes: disputes.data ?? [],
    teamError:
      publicTeams.error ??
      ownTeams.error ??
      invitations.error ??
      groups.error ??
      encounters.error ??
      lineups.error ??
      ownLineups.error ??
      rubbers.error ??
      results.error ??
      ownResults.error ??
      disputes.error,
  };
}
type TournamentData = ReturnType<typeof useTriace>;
export function TeamsHub() {
  const { user } = useSession();
  const teams = useList("teams", [["memberIds", "array-contains", user!.uid]]);
  const invitations = useList("invitations", [
    ["participantIds", "array-contains", user!.uid],
  ]);
  const events = useList("events", [
    ["visibility", "==", "public"],
    ["status", "!=", "Draft"],
  ]);
  return (
    <div className="page">
      <p className="eyebrow">BUILT TOGETHER. WON TOGETHER.</p>
      <h1>My teams</h1>
      <p className="lead">
        Your squad, your invitations, your next championship.
      </p>
      {(teams.error || invitations.error) && (
        <p className="error" role="alert">
          {(teams.error ?? invitations.error)?.message}
        </p>
      )}
      <div className="team-grid">
        {teams.data?.map((t) => (
          <Panel key={t.id}>
            <TeamCrest name={t.name} />
            <h2>{t.name}</h2>
            <p>{t.roster.length}/3 roster confirmed</p>
            <Link
              className="button secondary"
              to={`/events/${t.eventId}/triace`}
            >
              Open team tournament <ChevronRight size={16} />
            </Link>
          </Panel>
        ))}
      </div>
      <h2>Player invitations</h2>
      {invitations.data
        ?.filter((i) => i.playerId === user!.uid && i.status === "Pending")
        .map((i) => (
          <Invitation key={i.id} invitation={i} />
        ))}
      {!invitations.data?.some(
        (i) => i.playerId === user!.uid && i.status === "Pending",
      ) && <p className="muted">You’re all caught up.</p>}
      <Panel title="Find your team competition">
        {events.data
          ?.filter((e) => e.competition === "triace")
          .map((e) => (
            <div className="division-row" key={e.id}>
              <div>
                <strong>{e.name}</strong>
                <p>
                  {date(e.startDate, e.timezone)} · {e.location}
                </p>
              </div>
              <Link className="button primary" to={`/events/${e.id}/triace`}>
                View tournament
              </Link>
            </div>
          ))}
      </Panel>
    </div>
  );
}
export function TeamCrest({ name }: { name: string }) {
  return (
    <div className="team-crest" aria-hidden="true">
      <Shield size={56} strokeWidth={1} />
      <span>
        {name
          .split(" ")
          .map((w) => w[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()}
      </span>
    </div>
  );
}
export function TeamSchedule() {
  const { user } = useSession(),
    teams = useList("teams", [["memberIds", "array-contains", user!.uid]]),
    ids = [...new Set(teams.data?.map((t) => t.eventId) ?? [])];
  const a = useList(
    "teamEncounters",
    [
      ["eventId", "in", ids.length ? ids : ["none"]],
      ["published", "==", true],
    ],
    !!ids.length,
  );
  const encounters = (a.data ?? [])
    .filter((e) => teams.data?.some((t) => [e.teamA, e.teamB].includes(t.id)))
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  return (
    <Panel title="My team schedule">
      {a.error && (
        <p className="error" role="alert">
          {a.error.message}
        </p>
      )}
      {!encounters.length && (
        <p>
          No team fixtures yet.{" "}
          <Link to="/teams" className="text-link">
            Manage your teams →
          </Link>
        </p>
      )}
      {encounters.map((e) => (
        <div className="division-row" key={e.id}>
          <div>
            <strong>
              {teams.data?.find((t) => [e.teamA, e.teamB].includes(t.id))?.name}
            </strong>
            <p>
              {e.scheduledAt
                ? date(e.scheduledAt, e.timezone ?? "America/Chicago", true)
                : "Schedule to be announced"}{" "}
              · {e.courtId ?? "Court pending"}
            </p>
            <small>
              {e.phase === "playoffs" ? "Playoffs" : "Group play"} · Round{" "}
              {e.round}
            </small>
          </div>
          <Badge>{e.status}</Badge>
          <Link className="button secondary" to={`/events/${e.eventId}/triace`}>
            Lineup & scores
          </Link>
        </div>
      ))}
    </Panel>
  );
}
export function TeamHistory() {
  const { user } = useSession(),
    teams = useList("teams", [["memberIds", "array-contains", user!.uid]]),
    ids = [...new Set(teams.data?.map((t) => t.eventId) ?? [])],
    rubbers = useList(
      "rubbers",
      [
        ["eventId", "in", ids.length ? ids : ["none"]],
        ["published", "==", true],
      ],
      !!ids.length,
    );
  const results = useList("rubberResults", [
    ["participantIds", "array-contains", user!.uid],
  ]);
  const played =
    rubbers.data?.filter(
      (r) =>
        [...r.playersA, ...r.playersB].includes(user!.uid) &&
        r.status === "Final",
    ) ?? [];
  return (
    <Panel title="My TRIACE match history">
      {(rubbers.error || results.error) && (
        <p className="error" role="alert">
          {(rubbers.error ?? results.error)?.message}
        </p>
      )}
      {!played.length && (
        <p>Confirmed team rubbers you play will appear here.</p>
      )}
      {played.map((r) => {
        const result = results.data?.find(
            (s) => s.rubberId === r.id && s.state === "Final",
          ),
          team = teams.data?.find((t) => [r.teamA, r.teamB].includes(t.id));
        return (
          <div className="division-row" key={r.id}>
            <div>
              <strong>
                {team?.name} · {r.kind}
              </strong>
              <p>
                {result?.score.sets
                  .map((s: any) => `${s.a}–${s.b}`)
                  .join(" ") || r.outcome}{" "}
                · Version {r.version}
              </p>
            </div>
            <Badge>{r.winner === team?.id ? "Won" : "Played"}</Badge>
            <Link className="text-link" to={`/events/${r.eventId}/triace`}>
              Tournament →
            </Link>
          </div>
        );
      })}
    </Panel>
  );
}
function Invitation({ invitation: i }: { invitation: Entity }) {
  const action = useAction();
  return (
    <Panel title={`${i.teamName} · ${i.slot}`}>
      <p>
        Your captain invited you to play. Accepting confirms your roster place
        and waiver acknowledgement. Your display name and combined team
        reference will appear on the approved team roster.
      </p>
      <Link className="text-link" to={`/events/${i.eventId}/triace`}>
        Review event and waiver policy →
      </Link>
      <Form
        label="Accept invitation"
        onSubmit={(f) =>
          action("triace", {
            eventId: i.eventId,
            action: "respondInvitation",
            invitationId: i.id,
            accepted: true,
            waiver: f.get("waiver") === "on",
          })
        }
      >
        <label className="check">
          <input name="waiver" type="checkbox" required />I accept the event
          waiver and roster invitation.
        </label>
      </Form>
      <Action
        onClick={() =>
          action("triace", {
            eventId: i.eventId,
            action: "respondInvitation",
            invitationId: i.id,
            accepted: false,
          })
        }
      >
        Decline invitation
      </Action>
    </Panel>
  );
}
export function TriaceTournament({
  eventId,
  adminMode = false,
}: {
  eventId: string;
  adminMode?: boolean;
}) {
  const d = useTriace(eventId),
    { user } = useSession(),
    action = useAction();
  const [tab, setTab] = useState("Teams");
  const run = (actionName: string, data: any = {}) =>
    action("triace", { eventId, action: actionName, ...data });
  if (d.loading)
    return (
      <p role="status" className="page">
        Loading team tournament…
      </p>
    );
  if (d.error || d.teamError)
    return (
      <p role="alert" className="page error">
        {(d.error ?? d.teamError)?.message}
      </p>
    );
  if (!d.event) return <Empty title="Tournament not found" />;
  const event = d.event,
    rules = triaceRulesSchema.parse(event.triaceRules ?? {}),
    myTeams = d.teams.filter((t) => t.memberIds.includes(user?.uid));
  const champion = d.teams.find((t) => t.id === event.championTeamId);
  const groupGames = d.encounters.filter((e) => e.phase === "groups");
  return (
    <div className={adminMode ? "triace-workspace" : "page triace-workspace"}>
      <Link className="text-link" to={adminMode ? "/admin/events" : "/events"}>
        ← Event calendar
      </Link>
      <section className="triace-hero">
        <div>
          <p className="eyebrow">
            <Trophy size={15} /> PPRC SPORTS · TRIACE 2.0
          </p>
          <Badge>{event.status}</Badge>
          <h1>{event.name}</h1>
          <p>
            {event.location} · {date(event.startDate, event.timezone)} · Three
            players. One team.
          </p>
          <div className="triace-facts">
            <span>2 singles</span>
            <span>2 doubles</span>
            <span>10-point decider</span>
            <strong>First to 3</strong>
          </div>
        </div>
        <div className="triace-emblem" aria-hidden="true">
          <Trophy size={78} strokeWidth={1} />
          <span>TRIACE</span>
          <small>PLAY AS ONE</small>
        </div>
      </section>
      {champion && (
        <div className="champion-banner" role="status">
          <Trophy size={28} />
          <div>
            <small>CHAMPIONS</small>
            <h2>{champion.name}</h2>
          </div>
          <TeamCrest name={champion.name} />
        </div>
      )}
      {!rules.maximumPolicyConfirmed && (
        <p className="policy-note">
          Combined reference range: {rules.combinedMinimum}–
          {rules.combinedMaximum}. The maximum is pending final club policy
          confirmation.
        </p>
      )}
      {adminMode && d.admin && (
        <Panel title="Tournament operations">
          <div className="button-row">
            {["Draft", "Published"].includes(event.status) && (
              <Action
                variant="primary"
                onClick={() => action("publishEvent", { eventId })}
              >
                Publish tournament
              </Action>
            )}
            <Action
              disabled={!!d.groups.length}
              onClick={() => run("assignGroups")}
            >
              Assign groups
            </Action>
            <Action
              disabled={!d.groups.length || !!d.encounters.length}
              onClick={() => run("generateFixtures")}
            >
              Generate fixtures
            </Action>
            <Action
              disabled={
                !d.encounters.some(
                  (e) => !e.scheduledAt && e.status !== "Final",
                )
              }
              onClick={() => run("generateTeamSchedule")}
            >
              Generate team schedule
            </Action>
            <Action
              variant="primary"
              disabled={
                !groupGames.length ||
                groupGames.some((e) => e.status !== "Final") ||
                d.encounters.some((e) => e.phase === "playoffs")
              }
              onClick={() => run("generateTeamPlayoffs")}
            >
              Qualify & generate playoffs
            </Action>
            <Action
              onClick={async () => {
                const r = await run("exportTeamReport");
                const url = URL.createObjectURL(
                  new Blob([r.csv], { type: "text/csv" }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = "pprc-triace-teams.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export team report
            </Action>
            <Link to={`/events/${eventId}/triace`} className="button secondary">
              Public tournament page
            </Link>
          </div>
          <p className="muted">
            Approve paid or free teams before group assignment. Resolve
            qualification ties and participation requirements before playoffs.
          </p>
          {!!d.groups.length && !d.encounters.length && (
            <Form
              label="Reassign groups"
              onSubmit={(f) =>
                run("assignGroups", { reason: text(f, "reason") })
              }
            >
              <Field label="Group reassignment reason">
                <input name="reason" required minLength={5} />
              </Field>
            </Form>
          )}
          {!d.encounters.length &&
            !["Draft", "Published", "Completed", "Cancelled"].includes(
              event.status,
            ) && (
              <Form
                label="Update team registration window"
                onSubmit={(f) =>
                  action("applyAdminOverride", {
                    eventId,
                    kind: "status",
                    status: text(f, "status"),
                    reason: text(f, "reason"),
                  })
                }
              >
                <Field label="Team registration status">
                  <select
                    name="status"
                    defaultValue={
                      event.status === "Registration Open"
                        ? "Registration Open"
                        : "Registration Closed"
                    }
                  >
                    <option>Registration Open</option>
                    <option>Registration Closed</option>
                  </select>
                </Field>
                <Field label="Registration status reason">
                  <input name="reason" required minLength={5} />
                </Field>
              </Form>
            )}
        </Panel>
      )}
      {adminMode && d.support && (
        <p className="notice">Read-only support access.</p>
      )}
      <nav className="tabs" aria-label="Team tournament sections">
        {[
          "Teams",
          "Fixtures",
          "Standings",
          "Rules",
          ...(user ? ["Disputes"] : []),
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
      {tab === "Teams" && (
        <>
          {!user && (
            <Panel title="Your team starts here">
              <Link className="button primary" to="/signin">
                Sign in to create a team
              </Link>
            </Panel>
          )}
          {user &&
            !myTeams.some((t) => !t.withdrawn) &&
            event.status === "Registration Open" && (
              <Panel title="Captain your team">
                <Form
                  label="Create team"
                  onSubmit={(f) =>
                    run("createTeam", {
                      name: text(f, "name"),
                      waiver: f.get("waiver") === "on",
                    })
                  }
                >
                  <Field label="Team name">
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={60}
                      placeholder="Your team’s name"
                    />
                  </Field>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="waiver"
                      required={event.waiverRequired}
                    />
                    I accept the event waiver and consent to the public
                    approved-team roster.
                  </label>
                  <p>{event.refundPolicy}</p>
                </Form>
              </Panel>
            )}
          {d.invitations
            .filter((i) => i.playerId === user?.uid && i.status === "Pending")
            .map((i) => (
              <Invitation key={i.id} invitation={i} />
            ))}
          <div className="team-grid">
            {d.teams.map((t) => (
              <Panel key={t.id}>
                <div className="team-card-heading">
                  <TeamCrest name={t.name} />
                  <div>
                    <h2>{t.name}</h2>
                    <Badge>
                      {t.withdrawn
                        ? "Withdrawn"
                        : t.published
                          ? "Approved"
                          : t.registrationId
                            ? (d.registrations.find(
                                (r) => r.id === t.registrationId,
                              )?.state ?? "Registered")
                            : "Building roster"}
                    </Badge>
                  </div>
                </div>
                <ol className="team-roster">
                  {["P1", "P2", "P3"].map((slot) => {
                    const p = t.roster.find((r: any) => r.slot === slot);
                    return (
                      <li key={slot}>
                        <span>{slot}</span>
                        <strong>{p?.displayName ?? "Awaiting player"}</strong>
                        {p?.playerId === t.captainId && <small>Captain</small>}
                      </li>
                    );
                  })}
                </ol>
                {t.combinedReference !== undefined && (
                  <p className="reference-total">
                    Combined reference{" "}
                    <strong>{t.combinedReference.toFixed(2)}</strong>
                  </p>
                )}
                {t.captainId === user?.uid && !t.withdrawn && (
                  <CaptainControls team={t} data={d} run={run} />
                )}
                {adminMode &&
                  d.admin &&
                  t.registrationId &&
                  !t.withdrawn &&
                  !d.encounters.length && (
                    <Form
                      label="Approve team & seed"
                      onSubmit={(f) =>
                        run("approveTeam", {
                          teamId: t.id,
                          seed: number(f, "seed"),
                          reason: text(f, "reason"),
                        })
                      }
                    >
                      <Field label="Team seed">
                        <input
                          type="number"
                          name="seed"
                          min="0"
                          max="16"
                          defaultValue={
                            d.registrations.find(
                              (r) => r.id === t.registrationId,
                            )?.seed ?? 0
                          }
                        />
                      </Field>
                      <Field label="Approval reason">
                        <input name="reason" minLength={5} required />
                      </Field>
                    </Form>
                  )}
                {adminMode &&
                  d.admin &&
                  d.registrations.some(
                    (r) => r.id === t.registrationId && r.state === "Approved",
                  ) && (
                    <Form
                      label="Update team check-in"
                      onSubmit={(f) =>
                        action("checkInPlayer", {
                          eventId,
                          registrationId: t.registrationId,
                          status: text(f, "status"),
                        })
                      }
                    >
                      <Field label="Team check-in status">
                        <select
                          name="status"
                          defaultValue={
                            d.registrations.find(
                              (r) => r.id === t.registrationId,
                            )?.checkIn ?? "Not Checked In"
                          }
                        >
                          {[
                            "Not Checked In",
                            "Checked In",
                            "No Show",
                            "Withdrawn",
                          ].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </Field>
                    </Form>
                  )}
              </Panel>
            ))}
          </div>
          {!d.teams.length && (
            <Empty title="The field is taking shape">
              Captains can create teams and invite two players.
            </Empty>
          )}
        </>
      )}
      {tab === "Fixtures" && (
        <>
          <div className="section-heading">
            <div>
              <h2>Every point. Every team.</h2>
              <p className="muted">
                Lineups stay private until both captains submit.
              </p>
            </div>
          </div>
          {!d.encounters.length && (
            <Empty title="Fixtures will appear after group assignment" />
          )}
          {[...d.encounters]
            .sort(
              (a, b) =>
                (a.phase === "playoffs" ? 100 : 0) +
                a.round * 10 +
                a.position -
                ((b.phase === "playoffs" ? 100 : 0) +
                  b.round * 10 +
                  b.position),
            )
            .map((e) => (
              <EncounterCard
                key={e.id}
                encounter={e}
                data={d}
                rules={rules}
                run={run}
                adminMode={adminMode}
              />
            ))}
        </>
      )}
      {tab === "Standings" && (
        <>
          <div className="two-columns">
            {d.groups.map((g) => (
              <Panel key={g.id} title={g.name}>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th>P</th>
                        <th>W</th>
                        <th>Rubber +/-</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.standings.map((row: any, i: number) => (
                        <tr key={row.teamId}>
                          <td>
                            <span className="rank-number">{i + 1}</span>
                            {d.teams.find((t) => t.id === row.teamId)?.name ??
                              "Team"}
                            {row.tied && (
                              <small>Sporting tie · review required</small>
                            )}
                          </td>
                          <td>{row.played}</td>
                          <td>{row.wins}</td>
                          <td>{row.rubberDifference}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {adminMode &&
                  d.admin &&
                  !d.encounters.some((e) => e.phase === "playoffs") && (
                    <Form
                      label="Save tie resolution"
                      onSubmit={(f) =>
                        run("resolveTeamTies", {
                          groupId: g.id,
                          teamIds: f.getAll("teamOrder").map(String),
                          reason: text(f, "reason"),
                        })
                      }
                    >
                      {g.teamIds.map((_id: string, i: number) => (
                        <Field key={i} label={`Tie priority ${i + 1}`}>
                          <select
                            name="teamOrder"
                            defaultValue={g.standings[i].teamId}
                          >
                            {g.teamIds.map((id: string) => (
                              <option key={id} value={id}>
                                {d.teams.find((t) => t.id === id)?.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      ))}
                      <Field label="Tie resolution reason">
                        <input name="reason" required minLength={5} />
                      </Field>
                    </Form>
                  )}
              </Panel>
            ))}
          </div>
          <Panel title="Playoff singles participation">
            <p>
              Minimum {rules.singlesParticipationPercent}% of{" "}
              {rules.participationBasis === "encounters"
                ? "completed group encounters"
                : "available group singles rubbers"}
              . Only confirmed results count.
            </p>
            {d.teams
              .filter((t) => t.published)
              .map((t) => (
                <div className="participation-team" key={t.id}>
                  <h3>{t.name}</h3>
                  <div className="participation-grid">
                    {t.roster.map((p: any) => {
                      const s = singlesParticipation(
                        p.playerId,
                        t.id,
                        d.encounters,
                        d.rubbers,
                        rules,
                      );
                      return (
                        <div key={p.playerId}>
                          <span>{p.displayName}</span>
                          <strong>{s.percent.toFixed(0)}%</strong>
                          <small>
                            {s.appearances}/{s.opportunities} ·{" "}
                            {s.eligible ? "Eligible" : "Not yet eligible"}
                          </small>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </Panel>
          <Panel title="Championship bracket">
            {d.encounters
              .filter((e) => e.phase === "playoffs")
              .map((e) => (
                <div className="division-row" key={e.id}>
                  <strong>
                    {e.nextId ? "Semifinal / qualifier" : "Final"}
                  </strong>
                  <span>
                    {d.teams.find((t) => t.id === e.teamA)?.name ?? "TBD"}{" "}
                    {e.winsA}–{e.winsB}{" "}
                    {d.teams.find((t) => t.id === e.teamB)?.name ?? "TBD"}
                  </span>
                  <Badge>{e.status}</Badge>
                </div>
              ))}
          </Panel>
        </>
      )}
      {tab === "Rules" && (
        <>
          <RulesSummary rules={rules} />
          {adminMode && d.admin && <RulesEditor rules={rules} run={run} />}
        </>
      )}
      {tab === "Disputes" && (
        <>
          {!d.disputes.length && <Empty title="No score disputes" />}
          {d.disputes.map((dispute) => (
            <Panel key={dispute.id} title="Score review">
              <Badge>{dispute.status}</Badge>
              <p>{dispute.reason}</p>
              {dispute.status === "Resolved" && (
                <p>{dispute.resolutionReason}</p>
              )}
              {adminMode && d.admin && dispute.status === "Open" && (
                <>
                  <Form
                    label="Uphold original score"
                    onSubmit={(f) =>
                      run("resolveDispute", {
                        disputeId: dispute.id,
                        resolution: "uphold",
                        reason: text(f, "reason"),
                      })
                    }
                  >
                    <Field label="Resolution reason">
                      <input name="reason" minLength={5} required />
                    </Field>
                  </Form>
                  <RubberScoreForm
                    rubber={d.rubbers.find((r) => r.id === dispute.rubberId)!}
                    data={d}
                    rules={rules}
                    label="Apply corrected score"
                    reasonRequired
                    onSubmit={(score, reason) =>
                      run("resolveDispute", {
                        disputeId: dispute.id,
                        resolution: "correct",
                        score,
                        reason,
                      })
                    }
                  />
                </>
              )}
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}
function CaptainControls({
  team: t,
  data: d,
  run,
}: {
  team: Entity;
  data: TournamentData;
  run: (action: string, data?: any) => Promise<any>;
}) {
  const profiles = useList("publicProfiles");
  return (
    <div className="captain-controls">
      {!t.registrationId && (
        <>
          {t.roster.length < 3 && (
            <Form
              label="Send player invitation"
              onSubmit={(f) =>
                run("invitePlayer", {
                  teamId: t.id,
                  playerId: text(f, "playerId"),
                  slot: text(f, "slot"),
                })
              }
            >
              <Field label="Roster slot">
                <select name="slot">
                  {["P2", "P3"]
                    .filter((s) => !t.roster.some((p: any) => p.slot === s))
                    .map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                </select>
              </Field>
              <Field
                label="Player UID"
                hint="Choose a public player or enter the UID shared by a private player."
              >
                <input name="playerId" list={`players-${t.id}`} required />
              </Field>
              <datalist id={`players-${t.id}`}>
                {profiles.data
                  ?.filter((p) => !t.memberIds.includes(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
              </datalist>
            </Form>
          )}
          {d.invitations
            .filter((i) => i.teamId === t.id)
            .map((i) => (
              <div key={i.id}>
                <p className="muted">
                  {i.slot}: {i.playerId} · {i.status}
                </p>
                {i.status === "Pending" && (
                  <Action
                    onClick={() =>
                      run("revokeInvitation", { invitationId: i.id })
                    }
                  >
                    Revoke invitation
                  </Action>
                )}
              </div>
            ))}
          {t.roster.length === 3 && (
            <Form
              label="Register confirmed team"
              onSubmit={(f) =>
                run("registerTeam", {
                  teamId: t.id,
                  divisionId: text(f, "divisionId"),
                  answers: Object.fromEntries(
                    d.event!.questions.map((q: string) => [q, text(f, q)]),
                  ),
                })
              }
            >
              <Field label="Team division">
                <select name="divisionId">
                  {d.divisions.map((div) => (
                    <option key={div.id} value={div.id}>
                      {div.name}
                    </option>
                  ))}
                </select>
              </Field>
              {d.event!.questions.map((q: string) => (
                <Field key={q} label={q}>
                  <input name={q} required />
                </Field>
              ))}
            </Form>
          )}
        </>
      )}
      {t.registrationId && (
        <Link className="button secondary" to="/my-events">
          Registration & payment
        </Link>
      )}
      {!d.encounters.length && (
        <Form
          label="Withdraw team"
          onSubmit={(f) =>
            run("withdrawTeam", { teamId: t.id, reason: text(f, "reason") })
          }
        >
          <Field label="Withdrawal reason">
            <input name="reason" minLength={5} required />
          </Field>
        </Form>
      )}
    </div>
  );
}
function EncounterCard({
  encounter: e,
  data: d,
  rules,
  run,
  adminMode,
}: {
  encounter: Entity;
  data: TournamentData;
  rules: TriaceRules;
  run: (action: string, data?: any) => Promise<any>;
  adminMode: boolean;
}) {
  const { user } = useSession(),
    a = d.teams.find((t) => t.id === e.teamA),
    b = d.teams.find((t) => t.id === e.teamB);
  const own = [a, b].find((t) => t?.memberIds.includes(user?.uid)),
    captain = own?.captainId === user?.uid;
  const rs = d.rubbers
    .filter((r) => r.encounterId === e.id)
    .sort((a, b) => a.index - b.index);
  return (
    <section className="encounter-card" data-testid={`encounter-${e.id}`}>
      <div className="encounter-meta">
        <span>
          {e.phase === "playoffs"
            ? e.nextId
              ? "PLAYOFF · SEMIFINAL"
              : "CHAMPIONSHIP FINAL"
            : d.groups.find((g) => g.id === e.groupId)?.name.toUpperCase()}{" "}
          · ROUND {e.round}
        </span>
        <Badge>{e.status}</Badge>
      </div>
      <div className="team-scoreboard">
        <div>
          {a && <TeamCrest name={a.name} />}
          <h3>{a?.name ?? "To be decided"}</h3>
        </div>
        <div className="encounter-score">
          {e.winsA}
          <span>:</span>
          {e.winsB}
        </div>
        <div>
          {b && <TeamCrest name={b.name} />}
          <h3>{b?.name ?? "To be decided"}</h3>
        </div>
      </div>
      <p className="encounter-time">
        {e.scheduledAt
          ? `${date(e.scheduledAt, d.event!.timezone, true)} · ${e.courtId}`
          : "Schedule to be announced"}
      </p>
      {captain &&
        a &&
        b &&
        !d.lineups.some(
          (l) => l.encounterId === e.id && l.teamId === own!.id,
        ) &&
        e.status !== "Final" && (
          <LineupForm
            team={own!}
            rules={rules}
            onSubmit={(lineup) =>
              run("submitLineup", {
                teamId: own!.id,
                encounterId: e.id,
                lineup,
              })
            }
          />
        )}
      {!!d.lineups.filter((l) => l.encounterId === e.id).length &&
        !rs.length && (
          <p className="notice">
            Your lineup is locked. Waiting for the opposing captain.
          </p>
        )}
      {rs.map((r) => {
        const results = d.rubberResults.filter((x) => x.rubberId === r.id),
          pending = results.find(
            (x) => x.state === "Submitted" || x.state === "Disputed",
          ),
          final = results.find((x) => x.state === "Final"),
          authorized =
            !!own &&
            (captain || [...r.playersA, ...r.playersB].includes(user?.uid));
        return (
          <details className="rubber-row" key={r.id}>
            <summary>
              <span>
                {r.index + 1}.{" "}
                {r.kind === "tiebreak"
                  ? "10-point super tiebreak"
                  : `${r.kind} ${(r.index % 2) + 1}`}
              </span>
              <strong>
                {final?.score.sets.map((s: any) => `${s.a}–${s.b}`).join(" ") ||
                  final?.score.outcome ||
                  r.status}
              </strong>
            </summary>
            <p>
              {r.playersA
                .map(
                  (p: string) =>
                    a?.roster.find((x: any) => x.playerId === p)?.displayName,
                )
                .join(" / ")}{" "}
              <span className="muted">vs</span>{" "}
              {r.playersB
                .map(
                  (p: string) =>
                    b?.roster.find((x: any) => x.playerId === p)?.displayName,
                )
                .join(" / ")}
            </p>
            <small>Result version {r.version}</small>
            {(authorized || (adminMode && d.admin)) &&
              r.status === "Scheduled" && (
                <RubberScoreForm
                  rubber={r}
                  data={d}
                  rules={rules}
                  onSubmit={(score) =>
                    run("submitRubberScore", {
                      rubberId: r.id,
                      score,
                      baseVersion: r.version,
                    })
                  }
                />
              )}
            {pending && (
              <p>
                Submitted:{" "}
                {pending.score.sets
                  .map((s: any) => `${s.a}–${s.b}`)
                  .join(" ") || pending.score.outcome}{" "}
                · {pending.state}
              </p>
            )}
            {pending?.state === "Submitted" &&
              authorized &&
              own!.id !== pending.submittedTeamId && (
                <Action
                  variant="primary"
                  onClick={() =>
                    run("confirmRubberScore", { resultId: pending.id })
                  }
                >
                  Confirm opponent score
                </Action>
              )}
            {pending?.state === "Submitted" && adminMode && d.admin && (
              <Form
                label="Confirm as organizer"
                onSubmit={(f) =>
                  run("confirmRubberScore", {
                    resultId: pending.id,
                    reason: text(f, "reason"),
                  })
                }
              >
                <Field label="Organizer confirmation reason">
                  <input name="reason" required minLength={5} />
                </Field>
              </Form>
            )}
            {(authorized || (adminMode && d.admin)) &&
              (pending || final) &&
              !r.disputed && (
                <Form
                  label="Request score review"
                  onSubmit={(f) =>
                    run("disputeRubber", {
                      resultId: (pending ?? final)!.id,
                      reason: text(f, "reason"),
                    })
                  }
                >
                  <Field label="Score review reason">
                    <input name="reason" required minLength={5} />
                  </Field>
                </Form>
              )}
            {results.some((x) => x.state === "Superseded") && (
              <p className="muted">
                Previous score versions are retained in the audit history.
              </p>
            )}
          </details>
        );
      })}
      {adminMode && d.admin && e.status !== "Final" && a && b && (
        <details className="organizer-fixture-tools">
          <summary>Organizer scheduling & forfeit</summary>
          <Form
            label="Reschedule encounter"
            onSubmit={(f) =>
              run("scheduleEncounter", {
                encounterId: e.id,
                scheduledAt: new Date(text(f, "start") + "Z").toISOString(),
                courtId: text(f, "courtId"),
                reason: text(f, "reason"),
              })
            }
          >
            <Field label="Encounter start (UTC)">
              <input
                type="datetime-local"
                name="start"
                required
                defaultValue={e.scheduledAt?.slice(0, 16)}
              />
            </Field>
            <Field label="Encounter court">
              <select name="courtId">
                {d.event!.courtIds.map((id: string) => (
                  <option key={id}>{id}</option>
                ))}
              </select>
            </Field>
            <Field label="Rescheduling reason">
              <input name="reason" required minLength={5} />
            </Field>
          </Form>
          <Form
            label="Record team forfeit"
            onSubmit={(f) =>
              run("forfeitEncounter", {
                encounterId: e.id,
                winner: text(f, "winner"),
                reason: text(f, "reason"),
              })
            }
          >
            <Field label="Forfeit winner">
              <select name="winner">
                <option value={a.id}>{a.name}</option>
                <option value={b.id}>{b.name}</option>
              </select>
            </Field>
            <Field label="Forfeit reason">
              <input name="reason" required minLength={5} />
            </Field>
          </Form>
        </details>
      )}
    </section>
  );
}
function LineupForm({
  team,
  rules,
  onSubmit,
}: {
  team: Entity;
  rules: TriaceRules;
  onSubmit: (lineup: any) => Promise<any>;
}) {
  const roster = team.roster;
  const player = (name: string, label: string, index: number) => (
    <Field label={label}>
      <select name={name} defaultValue={roster[index]?.playerId}>
        {roster.map((p: any) => (
          <option key={p.playerId} value={p.playerId}>
            {p.slot} · {p.displayName}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <details className="lineup-editor">
      <summary>Submit captain lineup</summary>
      <Form
        label="Lock & submit lineup"
        onSubmit={(f) =>
          onSubmit({
            singles: [text(f, "s1"), text(f, "s2")],
            doubles: [
              { players: text(f, "d1").split("|") },
              { players: text(f, "d2").split("|") },
            ],
            tiebreak: [
              text(f, "t1"),
              ...(rules.tiebreakPlayers === 2 ? [text(f, "t2")] : []),
            ],
          })
        }
      >
        <div className="form-grid">
          {player("s1", "Singles 1 player", 0)}
          {player("s2", "Singles 2 player", 1)}
          {[0, 1].map((i) => (
            <Field key={i} label={`Doubles ${i + 1} pair`}>
              <select
                name={`d${i + 1}`}
                defaultValue={rules.allowedDoublesPairs[
                  i % rules.allowedDoublesPairs.length
                ]
                  .split("+")
                  .map((s) => roster.find((p: any) => p.slot === s).playerId)
                  .join("|")}
              >
                {rules.allowedDoublesPairs.map((pair) => (
                  <option
                    key={pair}
                    value={pair
                      .split("+")
                      .map(
                        (s) => roster.find((p: any) => p.slot === s).playerId,
                      )
                      .join("|")}
                  >
                    {pair}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          {player("t1", "Super tiebreak player 1", 2)}
          {rules.tiebreakPlayers === 2 &&
            player("t2", "Super tiebreak player 2", 0)}
        </div>
        <p className="muted">
          Lineups are locked on submission and revealed when both teams submit.
        </p>
      </Form>
    </details>
  );
}
function RubberScoreForm({
  rubber: r,
  data: d,
  rules,
  onSubmit,
  label = "Submit rubber score",
  reasonRequired = false,
}: {
  rubber: Entity;
  data: TournamentData;
  rules: TriaceRules;
  onSubmit: (score: any, reason?: string) => Promise<any>;
  label?: string;
  reasonRequired?: boolean;
}) {
  const [outcome, setOutcome] = useState("played"),
    sets = r.kind === "tiebreak" || rules.rubberScoring === "one-set" ? 1 : 3;
  return (
    <Form
      label={label}
      onSubmit={(f) =>
        onSubmit(
          {
            winner: text(f, "winner"),
            sets:
              outcome !== "played"
                ? []
                : Array.from({ length: sets }, (_, i) => i)
                    .filter(
                      (i) => text(f, `a${i}`) !== "" && text(f, `b${i}`) !== "",
                    )
                    .map((i) => ({
                      a: number(f, `a${i}`),
                      b: number(f, `b${i}`),
                    })),
            outcome,
            notes: text(f, "notes"),
          },
          text(f, "reason"),
        )
      }
    >
      <div className="form-grid">
        <Field label="Rubber winner">
          <select name="winner">
            <option value={r.teamA}>
              {d.teams.find((t) => t.id === r.teamA)?.name}
            </option>
            <option value={r.teamB}>
              {d.teams.find((t) => t.id === r.teamB)?.name}
            </option>
          </select>
        </Field>
        <Field label="Rubber outcome">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {["played", "forfeit", "walkover", "retirement"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      {outcome === "played" &&
        Array.from({ length: sets }, (_, i) => (
          <div className="form-grid" key={i}>
            <Field
              label={`Team A ${r.kind === "tiebreak" ? "points" : `set ${i + 1}`} `}
            >
              <input
                name={`a${i}`}
                type="number"
                min="0"
                max="99"
                required={sets === 1}
              />
            </Field>
            <Field
              label={`Team B ${r.kind === "tiebreak" ? "points" : `set ${i + 1}`} `}
            >
              <input
                name={`b${i}`}
                type="number"
                min="0"
                max="99"
                required={sets === 1}
              />
            </Field>
          </div>
        ))}
      <Field label="Rubber notes / exceptional outcome reason">
        <textarea name="notes" required={outcome !== "played"} />
      </Field>
      {reasonRequired && (
        <Field label="Correction audit reason">
          <input name="reason" required minLength={5} />
        </Field>
      )}
    </Form>
  );
}
function RulesSummary({ rules: r }: { rules: TriaceRules }) {
  return (
    <Panel title="The TRIACE rulebook">
      <div className="rule-grid">
        {[
          ["Roster", "Three confirmed players: P1, P2, P3"],
          [
            "Reference range",
            `${r.combinedMinimum}–${r.combinedMaximum} combined; higher of singles/doubles per player`,
          ],
          [
            "Encounter",
            "Two singles, two doubles, one 10-point super tiebreak",
          ],
          [
            "Victory",
            `First to three rubbers${r.stopAtClinch ? "; stop at clinch" : "; play all five"}`,
          ],
          [
            "Scoring",
            r.rubberScoring === "one-set"
              ? "One full set per singles/doubles rubber"
              : "Best of three full sets",
          ],
          ["Doubles pairs", r.allowedDoublesPairs.join(", ")],
          [
            "Decider",
            `${r.tiebreakPlayers} player(s) per side, ten points, win by two`,
          ],
          [
            "Playoff eligibility",
            `${r.singlesParticipationPercent}% singles participation; denominator: ${r.participationBasis}`,
          ],
          [
            "Qualification",
            `${r.groupCount} groups; ${r.qualifiersPerGroup} qualifiers per group`,
          ],
          [
            "Standings",
            "Encounter wins, rubber difference, explicit organizer tie resolution",
          ],
        ].map(([k, v]) => (
          <div key={k}>
            <small>{k}</small>
            <p>{v}</p>
          </div>
        ))}
      </div>
      <p>
        External UTR values are player-provided or admin-verified snapshots.
        PPRC does not calculate proprietary ratings.
      </p>
    </Panel>
  );
}
function RulesEditor({
  rules: r,
  run,
}: {
  rules: TriaceRules;
  run: (action: string, data?: any) => Promise<any>;
}) {
  return (
    <Panel title="Configure tournament rules">
      <p>
        Rules lock after team registration. Confirm club policy before
        publishing a live tournament.
      </p>
      <Form
        label="Save TRIACE rules"
        onSubmit={(f) =>
          run("configure", {
            rules: {
              ...r,
              combinedMinimum: number(f, "combinedMinimum"),
              combinedMaximum: number(f, "combinedMaximum"),
              groupCount: number(f, "groupCount"),
              qualifiersPerGroup: number(f, "qualifiersPerGroup"),
              singlesParticipationPercent: number(
                f,
                "singlesParticipationPercent",
              ),
              participationBasis: text(f, "participationBasis"),
              tiebreakPlayers: number(f, "tiebreakPlayers"),
              rubberScoring: text(f, "rubberScoring"),
              allowedDoublesPairs: f.getAll("pairs"),
              ...Object.fromEntries(
                [
                  "maximumPolicyConfirmed",
                  "requireAllRosterEligible",
                  "distinctSingles",
                  "distinctDoubles",
                  "stopAtClinch",
                  "forfeitCountsForParticipation",
                ].map((k) => [k, f.get(k) === "on"]),
              ),
            },
            reason: text(f, "reason"),
          })
        }
      >
        <div className="form-grid">
          {[
            ["combinedMinimum", "Combined minimum"],
            ["combinedMaximum", "Combined maximum"],
            ["groupCount", "Number of groups"],
            ["qualifiersPerGroup", "Qualifiers per group"],
            [
              "singlesParticipationPercent",
              "Minimum singles participation (%)",
            ],
          ].map(([k, l]) => (
            <Field key={k} label={l}>
              <input
                name={k}
                type="number"
                step="0.1"
                min="0"
                max="100"
                defaultValue={r[k as keyof TriaceRules] as number}
                required
              />
            </Field>
          ))}
          <Field label="Participation denominator">
            <select
              name="participationBasis"
              defaultValue={r.participationBasis}
            >
              <option value="encounters">Completed group encounters</option>
              <option value="singles-opportunities">
                Available group singles rubbers
              </option>
            </select>
          </Field>
          <Field label="Deciding tiebreak players per side">
            <select name="tiebreakPlayers" defaultValue={r.tiebreakPlayers}>
              <option value="1">One</option>
              <option value="2">Two</option>
            </select>
          </Field>
          <Field label="Singles and doubles scoring">
            <select name="rubberScoring" defaultValue={r.rubberScoring}>
              <option value="one-set">One set</option>
              <option value="best-of-three">Best of three sets</option>
            </select>
          </Field>
        </div>
        {["P1+P2", "P1+P3", "P2+P3"].map((p) => (
          <label className="check" key={p}>
            <input
              name="pairs"
              type="checkbox"
              value={p}
              defaultChecked={r.allowedDoublesPairs.includes(p as any)}
            />
            Allow {p}
          </label>
        ))}
        {[
          ["maximumPolicyConfirmed", "Club has confirmed the combined maximum"],
          [
            "requireAllRosterEligible",
            "Require playoff participation for all roster players",
          ],
          ["distinctSingles", "Require distinct singles players"],
          ["distinctDoubles", "Require distinct doubles pairs"],
          ["stopAtClinch", "Stop the encounter after three rubber wins"],
          [
            "forfeitCountsForParticipation",
            "Count assigned forfeited singles toward participation",
          ],
        ].map(([k, l]) => (
          <label className="check" key={k}>
            <input
              name={k}
              type="checkbox"
              defaultChecked={r[k as keyof TriaceRules] as boolean}
            />
            {l}
          </label>
        ))}
        <Field label="Rules change reason">
          <input name="reason" required minLength={5} />
        </Field>
      </Form>
    </Panel>
  );
}
