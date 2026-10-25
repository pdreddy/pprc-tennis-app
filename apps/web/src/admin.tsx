import { LadderTournament } from "./ladder";
import { ScoreForm } from "./scoring";
import { TriaceTournament } from "./teams";
import { ClubMembershipRequests } from "./club";
import { OperationsDashboard } from "./operations";
import { useState } from "react";
import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  CalendarDays,
  Users,
  Trophy,
  ClipboardList,
  MapPin,
  Shield,
  Plus,
  ArrowUpRight,
  Activity,
  CheckCircle2,
} from "lucide-react";
import { ref, uploadBytes, getBlob } from "firebase/storage";
import { storage } from "./firebase";
import {
  canManage,
  defaultTriaceRules,
  defaultKocRules,
  defaultDoublesRules,
  defaultLadderRules,
  nextLadderMonday,
  ladderWeekClose,
  formats,
  statuses,
  type Entity,
  type Event,
} from "@pprc/shared";
import { useSession, useAction, useList, useEvent } from "./context";
import {
  Field,
  Form,
  Action,
  Panel,
  Badge,
  Empty,
  date,
  money,
  text,
  number,
} from "./ui";
const tabs = [
  "Overview",
  "Registrations",
  "Divisions",
  "Draws",
  "Schedule",
  "Scores",
  "Reports",
];
export function Admin() {
  const { member, user } = useSession();
  const location = useLocation();
  const parts = location.pathname.split("/").filter(Boolean);
  const section = parts[1] ?? "dashboard",
    eventId = parts[2];
  const allowed = ["clubAdmin", "eventAdmin", "platformAdmin"].includes(
    member?.role,
  );
  const events = useList(
    "events",
    member?.role === "eventAdmin"
      ? [
          ["clubId", "==", "pprc"],
          ["assignedAdmins", "array-contains", user!.uid],
        ]
      : [["clubId", "==", "pprc"]],
    allowed,
  );
  if (!allowed)
    return (
      <div className="page">
        <Empty title="Administrator access required">
          Your club administrator can assign access to this portal.
        </Empty>
      </div>
    );
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <p className="eyebrow">CLUB OPERATIONS</p>
        <h3>Admin portal</h3>
        {[
          ["", "Overview", Activity],
          ["events", "Events", CalendarDays],
          ["operations", "Operations", Activity],
          ["club", "Club settings", Shield],
          ["courts", "Courts & venues", MapPin],
          ["members", "Members & roles", Users],
          ["audit", "Audit history", Shield],
        ].map(([path, label, Icon]) => {
          const I = Icon as typeof CalendarDays;
          return (
            <NavLink
              end={!path}
              key={String(path)}
              to={`/admin${path ? "/" + path : ""}`}
            >
              <I size={18} />
              {String(label)}
            </NavLink>
          );
        })}
        <div className="sidebar-note">
          <Shield size={21} />
          <p>
            {member?.role === "platformAdmin"
              ? "Read-only operational support"
              : "Trusted club operations"}
            <br />
            <small>Every change has a history.</small>
          </p>
        </div>
      </aside>
      <div className="admin-content">
        {events.error && <p className="error">{events.error.message}</p>}
        {eventId ? (
          <EventAdmin
            eventId={eventId}
            tab={(parts[3] ?? "overview").toLowerCase()}
          />
        ) : section === "club" ? (
          <ClubSettings />
        ) : section === "courts" ? (
          <Courts />
        ) : section === "members" ? (
          <Members />
        ) : section === "audit" ? (
          <Audits />
        ) : section === "operations" ? (
          <OperationsDashboard />
        ) : section === "events" ? (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">THE COMPETITION CALENDAR</p>
                <h1>Events</h1>
              </div>
              {member?.role !== "platformAdmin" && (
                <Link className="button primary" to="/admin/events/new">
                  <Plus size={17} />
                  Create event
                </Link>
              )}
            </div>
            <EventTable events={events.data ?? []} />
          </>
        ) : (
          <Dashboard events={events.data ?? []} />
        )}
      </div>
    </div>
  );
}
function ClubSettings() {
  const { member } = useSession(),
    action = useAction(),
    clubs = useList("clubs");
  const club = clubs.data?.find((c) => c.id === "pprc");
  return (
    <Panel title="Club settings">
      <p>Club identity and contact details for the PPRC workspace.</p>
      <fieldset disabled={member?.role !== "clubAdmin"} className="operations">
        <Form
          key={club?.updatedAt?.seconds ?? "club"}
          label="Save club settings"
          onSubmit={(f) =>
            action("manageClub", {
              target: "club",
              value: {
                name: text(f, "name"),
                timezone: text(f, "timezone"),
                location: text(f, "location"),
                contactEmail: text(f, "contactEmail"),
                acceptingMembershipRequests:
                  f.get("acceptingMembershipRequests") === "on",
              },
              reason: text(f, "reason"),
            })
          }
        >
          {[
            ["name", "Club name"],
            ["timezone", "Club timezone"],
            ["location", "Club location"],
            ["contactEmail", "Club contact email"],
          ].map(([k, l]) => (
            <Field key={k} label={l}>
              <input
                name={k}
                required
                type={k === "contactEmail" ? "email" : "text"}
                defaultValue={
                  club?.[k] ?? (k === "timezone" ? "America/Chicago" : "")
                }
              />
            </Field>
          ))}
          <label className="check">
            <input
              name="acceptingMembershipRequests"
              type="checkbox"
              defaultChecked={club?.acceptingMembershipRequests !== false}
            />
            Accept player membership requests
          </label>
          <Field label="Club update audit reason">
            <input name="reason" minLength={5} required />
          </Field>
        </Form>
      </fieldset>
    </Panel>
  );
}
function Dashboard({ events }: { events: Entity[] }) {
  const { member } = useSession();
  const ids = events.map((e) => e.id);
  const regs =
      useList(
        "registrations",
        member?.role === "eventAdmin"
          ? [["eventId", "in", ids.length ? ids : ["none"]]]
          : [["clubId", "==", "pprc"]],
      ).data ?? [],
    matches =
      useList(
        "matches",
        member?.role === "eventAdmin"
          ? [["eventId", "in", ids.length ? ids : ["none"]]]
          : [["clubId", "==", "pprc"]],
      ).data ?? [],
    payments =
      useList(
        "payments",
        member?.role === "eventAdmin"
          ? [["eventId", "in", ids.length ? ids : ["none"]]]
          : [["clubId", "==", "pprc"]],
      ).data ?? [];
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">A GREAT EVENT STARTS HERE</p>
          <h1>Club overview</h1>
          <p className="lead">The details behind every great day on court.</p>
        </div>
        {member?.role !== "platformAdmin" && (
          <Link to="/admin/events/new" className="button primary">
            <Plus size={17} /> Create event
          </Link>
        )}
      </div>
      <div className="stat-grid">
        {[
          [
            regs.filter((r) => r.state === "Registered").length,
            "Awaiting approval",
            Users,
          ],
          [
            regs.filter((r) => r.state === "Waitlisted").length,
            "On the waitlist",
            ClipboardList,
          ],
          [
            regs.filter((r) => r.state === "Pending Payment").length,
            "Payments pending",
            Activity,
          ],
          [
            matches.filter((m) => !["Final", "Bye"].includes(m.status)).length,
            "Matches awaiting scores",
            Trophy,
          ],
        ].map(([n, label, Icon]) => {
          const I = Icon as typeof Trophy;
          return (
            <div className="stat-card" key={String(label)}>
              <I />
              <strong>{String(n)}</strong>
              <span>{String(label)}</span>
            </div>
          );
        })}
      </div>
      <div className="two-columns">
        <Panel title="Needs your attention">
          <ul className="task-list">
            <li>
              <span>Approved players not checked in</span>
              <strong>
                {
                  regs.filter(
                    (r) => r.state === "Approved" && r.checkIn !== "Checked In",
                  ).length
                }
              </strong>
            </li>
            <li>
              <span>Refund requests</span>
              <strong>
                {
                  payments.filter(
                    (p) =>
                      p.refundRequested &&
                      ["Paid", "Refund Required"].includes(p.state),
                  ).length
                }
              </strong>
            </li>
            <li>
              <span>Completed events</span>
              <strong>
                {events.filter((e) => e.status === "Completed").length}
              </strong>
            </li>
          </ul>
        </Panel>
        <Panel title="Registration deadlines">
          {events
            .filter((e) => e.status === "Registration Open")
            .sort((a, b) =>
              a.registrationClose.localeCompare(b.registrationClose),
            )
            .slice(0, 4)
            .map((e) => (
              <div className="division-row" key={e.id}>
                <Link to={`/admin/events/${e.id}`}>{e.name}</Link>
                <small>{date(e.registrationClose, e.timezone, true)}</small>
              </div>
            ))}
        </Panel>
      </div>
      <EventTable events={events} />
      <ReportingQueue events={events} />
    </>
  );
}
function EventTable({ events }: { events: Entity[] }) {
  return (
    <Panel title="Your event calendar">
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Scrollable table"
      >
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Date</th>
              <th>Status</th>
              <th>Capacity</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link to={`/admin/events/${e.id}`}>
                    <strong>{e.name}</strong>
                  </Link>
                  <small>{e.venue}</small>
                </td>
                <td>{date(e.startDate, e.timezone)}</td>
                <td>
                  <Badge>{e.status}</Badge>
                </td>
                <td>{e.capacity}</td>
                <td>
                  <Link
                    className="round-link"
                    aria-label={`Manage ${e.name}`}
                    to={`/admin/events/${e.id}`}
                  >
                    <ArrowUpRight size={18} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!events.length && <Empty title="Start your first event" />}
    </Panel>
  );
}
function EventAdmin({ eventId, tab }: { eventId: string; tab: string }) {
  const d = useEvent(eventId),
    action = useAction(),
    { user, member } = useSession();
  const { event, divisions, registrations, draws, matches, results } = d;
  const profiles = useList("publicProfiles").data ?? [];
  const names = (id: string) =>
    profiles.find((p) => p.id === id)?.displayName ?? "TBD";
  if (d.loading) return <p role="status">Loading event operations…</p>;
  if (d.error)
    return (
      <p role="alert" className="error">
        {d.error.message}
      </p>
    );
  if (!event) return <Empty title="Event not found" />;
  if (event.competition === "ladder")
    return <LadderTournament eventId={eventId} adminMode />;
  if (["triace", "koc", "doubles"].includes(event.competition))
    return <TriaceTournament eventId={eventId} adminMode />;
  const readOnly = !canManage(member?.role, user!.uid, event as Event);
  const common = { eventId };
  const run = (name: string, p: Record<string, unknown> = {}) =>
    action(name, { ...common, ...p });
  return (
    <>
      <Link className="text-link" to="/admin/events">
        ← Event calendar
      </Link>
      <div className="section-heading">
        <div>
          <p className="eyebrow">EVENT WORKSPACE</p>
          <h1>{event.name}</h1>
          <p>
            {date(event.startDate, event.timezone, true)} · {event.venue}
          </p>
        </div>
        <Badge>{event.status}</Badge>
      </div>
      <nav className="tabs" aria-label="Event administration">
        {tabs.map((t) => (
          <NavLink
            key={t}
            end={t === "Overview"}
            to={`/admin/events/${eventId}${t === "Overview" ? "" : "/" + t.toLowerCase()}`}
          >
            {t}
          </NavLink>
        ))}
      </nav>
      {readOnly && (
        <p className="notice">
          Read-only support access. Operational changes require event or club
          administrator privileges.
        </p>
      )}
      <fieldset disabled={readOnly} className="operations">
        {tab === "overview" && (
          <>
            <div className="stat-grid">
              {[
                [registrations.length, "Registrations"],
                [
                  registrations.filter((r) => r.state === "Approved").length,
                  "Approved",
                ],
                [
                  matches.filter((m) => m.status === "Final").length,
                  "Final matches",
                ],
                [draws.length, "Draws"],
              ].map(([n, label]) => (
                <div className="stat-card" key={String(label)}>
                  <strong>{n}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <Panel title="Event controls">
              <div className="button-row">
                {["Draft", "Published"].includes(event.status) && (
                  <Action variant="primary" onClick={() => run("publishEvent")}>
                    Publish event
                  </Action>
                )}
                <Link to={`/events/${eventId}`} className="button secondary">
                  Public preview
                </Link>
                <Link
                  to={`/admin/events/new?duplicate=${eventId}`}
                  className="button secondary"
                >
                  Duplicate event
                </Link>
                <Action onClick={() => run("createEventTemplate")}>
                  Save as template
                </Action>
              </div>
              <Form
                label="Update event status"
                onSubmit={(f) =>
                  run("applyAdminOverride", {
                    kind: "status",
                    status: text(f, "status"),
                    reason: text(f, "reason"),
                  })
                }
              >
                <Field label="Event status">
                  <select name="status" defaultValue={event.status}>
                    {statuses
                      .filter((s) => !["Draft", "Published"].includes(s))
                      .map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                  </select>
                </Field>
                <Field label="Required audit reason">
                  <input name="reason" required minLength={5} />
                </Field>
              </Form>
            </Panel>
            <Panel title="Update registration settings">
              <Form
                onSubmit={(f) =>
                  run("updateEvent", {
                    event: {
                      registrationClose: new Date(
                        text(f, "close"),
                      ).toISOString(),
                      capacity: number(f, "capacity"),
                      description: text(f, "description"),
                    },
                  })
                }
              >
                <Field label="Description">
                  <textarea
                    name="description"
                    defaultValue={event.description}
                  />
                </Field>
                <Field label="Registration close (UTC)">
                  <input
                    name="close"
                    type="datetime-local"
                    defaultValue={event.registrationClose.slice(0, 16)}
                    required
                  />
                </Field>
                <Field label="Event capacity">
                  <input
                    name="capacity"
                    type="number"
                    min="2"
                    max="128"
                    defaultValue={event.capacity}
                    required
                  />
                </Field>
              </Form>
            </Panel>
          </>
        )}
        {tab === "registrations" && (
          <>
            <div className="section-heading">
              <h2>Entries & approvals</h2>
              <Action onClick={() => run("promoteWaitlist")}>
                Promote eligible waitlist
              </Action>
            </div>
            <p>
              Approve paid entries before generating draws. Seed changes require
              an audit reason.
            </p>
            {!registrations.length ? (
              <Empty title="Registrations will appear here" />
            ) : (
              registrations.map((r) => (
                <Panel key={r.id} title={r.displayName}>
                  <div className="row">
                    <Badge>{r.state}</Badge>
                    <span>
                      {divisions.find((d) => d.id === r.divisionId)?.name} ·
                      Reference {r.externalRating} · {r.checkIn}
                    </span>
                  </div>
                  <details className="registration-detail">
                    <summary>Waiver & registration answers</summary>
                    <p>
                      Waiver {r.waiver ? "acknowledged" : "not acknowledged"} ·
                      Policy version {r.waiverVersion ?? 1}
                    </p>
                    <dl>
                      {Object.entries(r.answers ?? {}).map(([q, a]) => (
                        <div key={q}>
                          <dt>{q}</dt>
                          <dd>{String(a)}</dd>
                        </div>
                      ))}
                    </dl>
                    {r.waiverPath && (
                      <Action
                        onClick={async () => {
                          const blob = await getBlob(
                            ref(storage, r.waiverPath),
                          );
                          const url = URL.createObjectURL(blob),
                            a = document.createElement("a");
                          a.href = url;
                          a.download = `waiver-${r.id}.pdf`;
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        }}
                      >
                        Download signed waiver
                      </Action>
                    )}
                  </details>
                  {["Registered", "Approved"].includes(r.state) && (
                    <Form
                      label="Approve & save seed"
                      onSubmit={(f) =>
                        run("approveRegistration", {
                          registrationId: r.id,
                          seed: number(f, "seed"),
                          reason: text(f, "reason"),
                        })
                      }
                    >
                      <div className="form-grid">
                        <Field label="Seed (0 = external-reference ordering)">
                          <input
                            name="seed"
                            type="number"
                            min="0"
                            max="128"
                            defaultValue={r.seed}
                          />
                        </Field>
                        <Field label="Seed change reason">
                          <input
                            name="reason"
                            placeholder="Required when changing a seed"
                          />
                        </Field>
                      </div>
                    </Form>
                  )}
                  {r.state === "Approved" && (
                    <Form
                      label="Update check-in"
                      onSubmit={(f) =>
                        run("checkInPlayer", {
                          registrationId: r.id,
                          status: text(f, "checkIn"),
                        })
                      }
                    >
                      <Field label="Check-in status">
                        <select name="checkIn" defaultValue={r.checkIn}>
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
                  {[
                    "Registered",
                    "Approved",
                    "Waitlisted",
                    "Pending Payment",
                  ].includes(r.state) && (
                    <Form
                      label="Reject entry"
                      onSubmit={(f) =>
                        run("rejectRegistration", {
                          registrationId: r.id,
                          reason: text(f, "reason"),
                        })
                      }
                    >
                      <Field label="Rejection reason">
                        <input name="reason" required minLength={5} />
                      </Field>
                    </Form>
                  )}
                </Panel>
              ))
            )}
          </>
        )}
        {tab === "divisions" && (
          <>
            {divisions.map((v) => (
              <Panel key={v.id} title={v.name}>
                <Badge>{v.format}</Badge>
                <p>
                  {v.capacity} places · {money(v.fee ?? event.fee)} · {v.gender}
                </p>
                <p>
                  Reference {v.minRating}–{v.maxRating} · Ages {v.minAge}–
                  {v.maxAge}
                </p>
                <p>Scoring: {v.scoring}. No-ad. Tiebreak at 6–6.</p>
              </Panel>
            ))}
            <p className="notice">
              Division configuration is established by the creation wizard and
              protected once entries exist.
            </p>
          </>
        )}
        {tab === "draws" && (
          <>
            {divisions.map((v) => (
              <Panel key={v.id} title={v.name}>
                <p>
                  {v.format} · Approved entries:{" "}
                  {
                    registrations.filter(
                      (r) => r.divisionId === v.id && r.state === "Approved",
                    ).length
                  }
                </p>
                <Action
                  variant="primary"
                  disabled={draws.some((dr) => dr.divisionId === v.id)}
                  onClick={() => run("generateDraw", { divisionId: v.id })}
                >
                  Generate draw
                </Action>
              </Panel>
            ))}
            {draws.map((draw) => (
              <Panel
                key={draw.id}
                title={`${divisions.find((v) => v.id === draw.divisionId)?.name} · ${draw.phase}`}
              >
                <Badge>{draw.published ? "Published" : "Unpublished"}</Badge>
                <Action
                  onClick={() =>
                    run("publishDraw", {
                      drawId: draw.id,
                      published: !draw.published,
                    })
                  }
                >
                  {draw.published ? "Unpublish draw" : "Publish draw"}
                </Action>
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Scrollable table"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Round</th>
                        <th>Player 1</th>
                        <th>Player 2</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matches
                        .filter((m) => m.drawId === draw.id)
                        .map((m) => (
                          <tr key={m.id}>
                            <td>{m.round}</td>
                            <td>{names(m.p1)}</td>
                            <td>{names(m.p2)}</td>
                            <td>
                              <Badge>{m.status}</Badge>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {draw.phase === "groups" && (
                  <>
                    <Action
                      onClick={() =>
                        run("updateRoundRobinStandings", {
                          divisionId: draw.divisionId,
                        })
                      }
                    >
                      Refresh standings / qualify playoffs
                    </Action>
                    <Form
                      label="Resolve standings tie"
                      onSubmit={(f) =>
                        run("applyAdminOverride", {
                          kind: "standings",
                          drawId: draw.id,
                          resolutions: JSON.parse(text(f, "resolutions")),
                          reason: text(f, "reason"),
                        })
                      }
                    >
                      <Field label="Unique admin positions (JSON player ID → position)">
                        <textarea
                          name="resolutions"
                          defaultValue="{}"
                          required
                        />
                      </Field>
                      <Field label="Required resolution reason">
                        <input name="reason" minLength={5} required />
                      </Field>
                    </Form>
                  </>
                )}
              </Panel>
            ))}
          </>
        )}
        {tab === "schedule" && (
          <>
            <Panel title="Court scheduling">
              <p>
                Available courts: {event.courtIds.join(", ")}. Match{" "}
                {event.duration} min + buffer {event.buffer} min. Times below
                are entered in UTC.
              </p>
              <Action variant="primary" onClick={() => run("generateSchedule")}>
                Generate schedule
              </Action>
            </Panel>
            {matches
              .filter((m) => m.status !== "Bye")
              .map((m) => (
                <Panel
                  key={m.id}
                  title={`Round ${m.round}: ${names(m.p1)} vs ${names(m.p2)}`}
                >
                  <p>
                    {m.scheduledAt
                      ? date(m.scheduledAt, event.timezone, true)
                      : "Unscheduled"}
                  </p>
                  <Form
                    label="Reschedule match"
                    onSubmit={(f) =>
                      run("rescheduleMatch", {
                        matchId: m.id,
                        courtId: text(f, "court"),
                        scheduledAt: new Date(
                          text(f, "time") + "Z",
                        ).toISOString(),
                        reason: text(f, "reason"),
                      })
                    }
                  >
                    <div className="form-grid">
                      <Field label="Court">
                        <select
                          name="court"
                          defaultValue={m.courtId ?? event.courtIds[0]}
                        >
                          {event.courtIds.map((c: string) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Match time (UTC)">
                        <input
                          type="datetime-local"
                          required
                          name="time"
                          defaultValue={m.scheduledAt?.slice(0, 16)}
                        />
                      </Field>
                    </div>
                    <Field label="Schedule change reason">
                      <input name="reason" required minLength={5} />
                    </Field>
                  </Form>
                </Panel>
              ))}
          </>
        )}
        {tab === "scores" && (
          <>
            {matches
              .filter((m) => m.p1 && m.p2 && m.status !== "Bye")
              .map((m) => (
                <Panel
                  key={m.id}
                  title={`Round ${m.round}: ${names(m.p1)} vs ${names(m.p2)}`}
                >
                  <Badge>{m.status}</Badge>
                  <p>Score version {m.version}</p>
                  {!["Final", "Awaiting confirmation"].includes(m.status) && (
                    <ScoreForm
                      match={m}
                      onSubmit={(p) =>
                        run("submitScore", {
                          matchId: m.id,
                          version: m.version,
                          ...p,
                        })
                      }
                    />
                  )}{" "}
                  {results
                    .filter((r) => r.matchId === m.id)
                    .map((r) => (
                      <div className="score-record" key={r.id}>
                        <p>
                          <strong>
                            {r.score.sets
                              .map((s: any) => `${s.a}–${s.b}`)
                              .join(" ") || r.score.outcome}
                          </strong>{" "}
                          · {r.state} · v{r.version}
                        </p>
                        <p>Submitted by {names(r.submittedBy)}</p>
                        {r.state === "Submitted" && (
                          <Action
                            onClick={() =>
                              run("finalizeScore", { resultId: r.id })
                            }
                          >
                            Finalize result
                          </Action>
                        )}
                        {r.state !== "Superseded" && (
                          <Form
                            label={
                              r.correctionRequested
                                ? "Approve correction & reopen match"
                                : "Request score correction"
                            }
                            onSubmit={(f) =>
                              run(
                                r.correctionRequested
                                  ? "applyAdminOverride"
                                  : "requestScoreCorrection",
                                {
                                  kind: "score",
                                  resultId: r.id,
                                  reason: text(f, "reason"),
                                },
                              )
                            }
                          >
                            <Field label="Correction audit reason">
                              <input
                                name="reason"
                                required
                                minLength={5}
                                defaultValue={r.correctionReason}
                              />
                            </Field>
                          </Form>
                        )}
                        <Form
                          label="Update reporting status"
                          onSubmit={(f) =>
                            run("applyAdminOverride", {
                              kind: "reporting",
                              resultId: r.id,
                              status: text(f, "reporting"),
                              reason: text(f, "reason"),
                            })
                          }
                        >
                          <Field label="External reporting reference (manual only)">
                            <select
                              name="reporting"
                              defaultValue={r.reportingStatus}
                            >
                              {[
                                "Not Required",
                                "Pending",
                                "Submitted",
                                "Confirmed",
                              ].map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Reason">
                            <input name="reason" required minLength={5} />
                          </Field>
                        </Form>
                      </div>
                    ))}
                </Panel>
              ))}
          </>
        )}
        {tab === "reports" && <Reports eventId={eventId} />}
      </fieldset>
    </>
  );
}
function Reports({ eventId }: { eventId: string }) {
  const action = useAction(),
    payments = useList("payments", [["eventId", "==", eventId]]).data ?? [];
  return (
    <>
      <Panel title="Event exports">
        <p>
          Exports include only this event. Financial details and audit history
          stay inside the admin portal.
        </p>
        <div className="button-row">
          {["registrations", "results", "payments"].map((kind) => (
            <Action
              key={kind}
              onClick={async () => {
                const r = await action("exportEventReport", { eventId, kind });
                const url = URL.createObjectURL(
                  new Blob([r.csv], { type: "text/csv;charset=utf-8" }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = r.filename;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export {kind} CSV
            </Action>
          ))}
        </div>
      </Panel>
      <Panel title="Payments & refunds">
        {payments.map((p) => (
          <div className="score-record" key={p.id}>
            <Badge>{p.state}</Badge>
            <p>
              {money(p.amount)} · {p.playerId} · {p.provider}
            </p>
            {p.refundRequested && (
              <p className="notice">Refund requested: {p.refundReason}</p>
            )}
            {["Paid", "Refund Required"].includes(p.state) &&
              p.refundRequested && (
                <Form
                  label="Process refund"
                  onSubmit={(f) =>
                    action("refundPayment", {
                      eventId,
                      paymentId: p.id,
                      reason: text(f, "reason"),
                    })
                  }
                >
                  <Field label="Refund audit reason">
                    <input name="reason" required minLength={5} />
                  </Field>
                </Form>
              )}
          </div>
        ))}
      </Panel>
      <Audits eventId={eventId} />
    </>
  );
}
function ReportingQueue({ events }: { events: Entity[] }) {
  const { member } = useSession();
  const ids = events.map((e) => e.id);
  const results =
    useList(
      "matchResults",
      member?.role === "eventAdmin"
        ? [["eventId", "in", ids.length ? ids : ["none"]]]
        : [["clubId", "==", "pprc"]],
    ).data ?? [];
  return (
    <Panel title="Reporting-status queue">
      {results
        .filter((r) => ["Pending", "Submitted"].includes(r.reportingStatus))
        .map((r) => (
          <div className="division-row" key={r.id}>
            <Link to={`/admin/events/${r.eventId}/scores`}>
              Match {r.matchId}
            </Link>
            <Badge>{r.reportingStatus}</Badge>
          </div>
        ))}
      {!results.some((r) =>
        ["Pending", "Submitted"].includes(r.reportingStatus),
      ) && (
        <p>
          No outstanding reporting records. No results are sent to external
          services.
        </p>
      )}
    </Panel>
  );
}
function Courts() {
  const courts = useList("courts").data ?? [],
    venues = useList("venues").data ?? [],
    blocks = useList("courtBlocks").data ?? [],
    action = useAction(),
    { member } = useSession();
  const courtName = (id: string) => courts.find((c) => c.id === id)?.name ?? id;
  return (
    <>
      <h1>Courts & venues</h1>
      <div className="stat-grid">
        {courts.map((c) => (
          <Panel key={c.id} title={c.name}>
            <MapPin />
            <p>
              {c.surface} · {c.active ? "Available" : "Unavailable"}
            </p>
          </Panel>
        ))}
      </div>
      <Panel title="Maintenance blocks">
        <p className="lead">
          Blocked courts are excluded from fixture and reschedule placement.
          Times use this browser's local timezone.
        </p>
        {blocks.length ? (
          <ul>
            {blocks.map((b) => (
              <li key={b.id}>
                <strong>{courtName(b.courtId)}</strong>:{" "}
                {new Date(b.start).toLocaleString()} to{" "}
                {new Date(b.end).toLocaleString()} — {b.reason}
                {member?.role === "clubAdmin" && (
                  <Form
                    label="Remove block"
                    onSubmit={(f) =>
                      action("manageClub", {
                        target: "courtBlock",
                        action: "remove",
                        blockId: b.id,
                        reason: text(f, "reason"),
                      })
                    }
                  >
                    <Field label="Removal reason">
                      <input name="reason" required minLength={5} />
                    </Field>
                  </Form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>No maintenance blocks.</p>
        )}
      </Panel>
      {member?.role === "clubAdmin" && (
        <Panel title="Block a court for maintenance">
          <Form
            label="Add block"
            onSubmit={(f) =>
              action("manageClub", {
                target: "courtBlock",
                action: "add",
                value: {
                  courtId: text(f, "courtId"),
                  start: new Date(text(f, "start")).toISOString(),
                  end: new Date(text(f, "end")).toISOString(),
                  reason: text(f, "blockReason"),
                },
                reason: text(f, "reason"),
              })
            }
          >
            <Field label="Court">
              <select name="courtId">
                {courts.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start">
              <input name="start" type="datetime-local" required />
            </Field>
            <Field label="End">
              <input name="end" type="datetime-local" required />
            </Field>
            <Field label="Block reason">
              <input name="blockReason" required minLength={2} />
            </Field>
            <Field label="Audit reason">
              <input name="reason" required minLength={5} />
            </Field>
          </Form>
        </Panel>
      )}
      {member?.role === "clubAdmin" && (
        <Panel title="Add or update a court">
          <Form
            onSubmit={(f) =>
              action("manageClub", {
                target: "court",
                id: text(f, "id"),
                value: {
                  name: text(f, "name"),
                  venueId: text(f, "venueId"),
                  surface: text(f, "surface"),
                  active: f.get("active") === "on",
                },
                reason: text(f, "reason"),
              })
            }
          >
            {[
              ["id", "Court ID"],
              ["name", "Court name"],
              ["surface", "Surface"],
              ["reason", "Audit reason"],
            ].map(([k, l]) => (
              <Field key={k} label={l}>
                <input name={k} required minLength={k === "reason" ? 5 : 2} />
              </Field>
            ))}
            <Field label="Venue">
              <select name="venueId">
                {venues.map((v) => (
                  <option value={v.id} key={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="check">
              <input name="active" type="checkbox" defaultChecked />
              Court available
            </label>
          </Form>
        </Panel>
      )}
      {member?.role === "clubAdmin" && (
        <Panel title="Add or update a venue">
          <Form
            onSubmit={(f) =>
              action("manageClub", {
                target: "venue",
                id: text(f, "venueId"),
                value: { name: text(f, "name"), location: text(f, "location") },
                reason: text(f, "reason"),
              })
            }
          >
            {[
              ["venueId", "Venue ID"],
              ["name", "Venue name"],
              ["location", "City and state"],
              ["reason", "Audit reason"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  name={key}
                  minLength={key === "reason" ? 5 : 2}
                  required
                />
              </Field>
            ))}
          </Form>
        </Panel>
      )}
    </>
  );
}
function Members() {
  const { member } = useSession(),
    action = useAction();
  const users = useList(
    "users",
    [["clubId", "==", "pprc"]],
    ["clubAdmin", "platformAdmin"].includes(member?.role),
  );
  const memberships =
    useList(
      "memberships",
      [["clubId", "==", "pprc"]],
      ["clubAdmin", "platformAdmin"].includes(member?.role),
    ).data ?? [];
  return (
    <>
      <h1>Members & roles</h1>
      <ClubMembershipRequests />
      {!["clubAdmin", "platformAdmin"].includes(member?.role) ? (
        <Empty title="Club administrator access required" />
      ) : (
        <Panel title="Club directory">
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Scrollable table"
          >
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>City</th>
                  <th>Role</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {users.data?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.displayName}
                      <small>{u.id}</small>
                    </td>
                    <td>{u.city}</td>
                    <td>
                      {memberships.find((m) => m.id === u.id)?.role ?? "player"}
                    </td>
                    <td>
                      {u.externalRating ?? "—"}
                      <small>{u.ratingSource}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {member?.role === "clubAdmin" && (
        <Panel title="Assign club membership and role">
          <Form
            onSubmit={(f) =>
              action("manageClub", {
                target: "membership",
                id: text(f, "id"),
                role: text(f, "role"),
                member: f.get("member") === "on",
                reason: text(f, "reason"),
              })
            }
          >
            <Field label="Firebase player UID">
              <input name="id" required />
            </Field>
            <Field label="Role">
              <select name="role">
                {["player", "eventAdmin", "clubAdmin", "platformAdmin"].map(
                  (r) => (
                    <option key={r}>{r}</option>
                  ),
                )}
              </select>
            </Field>
            <label className="check">
              <input type="checkbox" name="member" defaultChecked />
              Club member
            </label>
            <Field label="Required audit reason">
              <input name="reason" required minLength={5} />
            </Field>
          </Form>
        </Panel>
      )}
      {member?.role === "clubAdmin" && (
        <Panel title="Verify an external rating reference">
          <Form
            onSubmit={(f) =>
              action("manageClub", {
                target: "rating",
                id: text(f, "id"),
                rating: number(f, "rating"),
                ...(text(f, "singlesUtr")
                  ? { singlesUtr: number(f, "singlesUtr") }
                  : {}),
                ...(text(f, "doublesUtr")
                  ? { doublesUtr: number(f, "doublesUtr") }
                  : {}),
                reason: text(f, "reason"),
              })
            }
          >
            <Field label="Player UID">
              <input name="id" required />
            </Field>
            <Field label="External reference value">
              <input
                name="rating"
                type="number"
                min="0"
                max="20"
                step="0.01"
                required
              />
            </Field>
            {["singlesUtr", "doublesUtr"].map((k) => (
              <Field
                key={k}
                label={
                  k === "singlesUtr"
                    ? "Verified singles UTR"
                    : "Verified doubles UTR"
                }
                hint="Optional; defaults to the external reference above when omitted."
              >
                <input name={k} type="number" min="0" max="20" step="0.01" />
              </Field>
            ))}
            <Field label="Verification source / audit reason">
              <input name="reason" minLength={5} required />
            </Field>
          </Form>
        </Panel>
      )}
    </>
  );
}
function Audits({ eventId }: { eventId?: string }) {
  const { member } = useSession();
  const entries = useList(
    "auditEvents",
    eventId
      ? [
          ["clubId", "==", "pprc"],
          ["eventId", "==", eventId],
        ]
      : [["clubId", "==", "pprc"]],
    !!eventId || ["clubAdmin", "platformAdmin"].includes(member?.role),
  );
  return (
    <Panel title="Immutable audit history">
      {entries.error && (
        <p role="alert" className="error">
          {entries.error.message}
        </p>
      )}
      {!entries.data?.length && (
        <p>No audit entries available in this scope.</p>
      )}
      {entries.data
        ?.sort(
          (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
        )
        .slice(0, 100)
        .map((a) => (
          <details className="audit-row" key={a.id}>
            <summary>
              <strong>{a.action}</strong>
              <span>
                {a.actor} ·{" "}
                {a.createdAt?.toDate?.().toLocaleString() ??
                  "Pending timestamp"}
              </span>
            </summary>
            <p>Reason: {a.reason ?? "Routine operation"}</p>
            <pre>
              {JSON.stringify({ before: a.before, after: a.after }, null, 2)}
            </pre>
          </details>
        ))}
    </Panel>
  );
}
const local = (d: Date) => d.toISOString().slice(0, 16);
const defaultDivision = {
  name: "Open singles",
  format: "single-elimination",
  capacity: 16,
  minRating: 0,
  maxRating: 20,
  minAge: 0,
  maxAge: 120,
  gender: "Open",
  scoring: "match-tiebreak",
  groupSize: 4,
  qualifiers: 2,
};
export function EventWizard() {
  const { member, user } = useSession(),
    action = useAction(),
    navigate = useNavigate();
  const [params] = useSearchParams();
  const duplicate = params.get("duplicate");
  const existing = useEvent(duplicate ?? "");
  const templates =
    useList(
      "eventTemplates",
      [["clubId", "==", "pprc"]],
      member?.role === "clubAdmin",
    ).data ?? [];
  const courts = useList("courts").data ?? [];
  const [cover, setCover] = useState<File | null>(null);
  const [competition, setCompetition] = useState("individual");
  const [teamStage, setTeamStage] = useState("groups-playoffs");
  const [step, setStep] = useState(0),
    [divisions, setDivisions] = useState<any[]>([{ ...defaultDivision }]),
    [template, setTemplate] = useState<Entity | undefined>();
  const [loaded, setLoaded] = useState(false);
  const source = template?.event ?? existing.event;
  if (source && !loaded) {
    setCompetition(source.competition ?? "individual");
    setTeamStage(source.teamRules?.stageFormat ?? "groups-playoffs");
    setLoaded(true);
    setDivisions(
      (template?.divisions ?? existing.divisions).map((d: Entity) => ({
        ...d,
      })),
    );
  }
  if (!["clubAdmin", "eventAdmin"].includes(member?.role))
    return (
      <div className="page">
        <Empty title="Event creation requires administrator access" />
      </div>
    );
  const ladderStart = nextLadderMonday(
    Date.now() + 14 * 86400000,
    source?.timezone ?? "America/Chicago",
  );
  const start = local(
      new Date(
        competition === "ladder" ? ladderStart : Date.now() + 14 * 86400000,
      ),
    ),
    end = local(
      new Date(
        competition === "ladder"
          ? ladderWeekClose(
              new Date(ladderStart).toISOString(),
              source?.timezone ?? "America/Chicago",
              8,
            )
          : Date.now() + 15 * 86400000,
      ),
    );
  const update = (i: number, k: string, v: any) =>
    setDivisions((ds) => ds.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  return (
    <div className="page wizard">
      <Link className="text-link" to="/admin/events">
        ← Events
      </Link>
      <p className="eyebrow">MAKE A GREAT DAY ON COURT</p>
      <h1>{duplicate ? "Duplicate event" : "Create an event"}</h1>
      <p className="lead">From the first invitation to the final point.</p>
      <ol className="wizard-steps">
        {["Basics", "Registration", "Divisions", "Scheduling", "Publish"].map(
          (label, i) => (
            <li
              key={label}
              className={step === i ? "current" : step > i ? "complete" : ""}
            >
              <button type="button" onClick={() => setStep(i)}>
                <span>{step > i ? <CheckCircle2 size={16} /> : i + 1}</span>
                {label}
              </button>
            </li>
          ),
        )}
      </ol>
      {templates.length > 0 && (
        <Field label="Start from an event template">
          <select
            onChange={(e) => {
              setTemplate(templates.find((t) => t.id === e.target.value));
              setLoaded(false);
            }}
          >
            <option value="">Blank event</option>
            {templates.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Panel>
        <Form
          key={source?.id ?? template?.id ?? "new"}
          label={step < 4 ? "Continue" : "Create draft event"}
          onSubmit={async (f) => {
            if (step < 4) {
              setStep((s) => s + 1);
              return;
            }
            const toISO = (k: string) =>
              new Date(text(f, k) + "Z").toISOString();
            let coverPath = source?.coverPath;
            if (cover) {
              coverPath = `covers/${user!.uid}/${crypto.randomUUID()}`;
              await uploadBytes(ref(storage, coverPath), cover, {
                contentType: cover.type,
              });
            }
            const event = {
              competition,
              ...(competition === "triace"
                ? { triaceRules: source?.triaceRules ?? defaultTriaceRules }
                : {}),
              ...(["koc", "doubles"].includes(competition)
                ? {
                    teamRules: {
                      ...(source?.teamRules ??
                        (competition === "doubles"
                          ? defaultDoublesRules
                          : defaultKocRules)),
                      stageFormat: teamStage,
                      groupCount:
                        teamStage === "round-robin"
                          ? 1
                          : (source?.teamRules?.groupCount ?? 1),
                    },
                  }
                : {}),
              ...(competition === "ladder"
                ? { ladderRules: source?.ladderRules ?? defaultLadderRules }
                : {}),
              ...(coverPath ? { coverPath } : {}),
              name: text(f, "name"),
              description: text(f, "description"),
              venue: text(f, "venue"),
              location: text(f, "location"),
              startDate: toISO("startDate"),
              endDate: toISO("endDate"),
              timezone: text(f, "timezone"),
              visibility: text(f, "visibility"),
              fee: Math.round(number(f, "fee") * 100),
              capacity: number(f, "capacity"),
              waitlist: f.get("waitlist") === "on",
              registrationOpen: toISO("registrationOpen"),
              registrationClose: toISO("registrationClose"),
              waiverRequired: f.get("waiverRequired") === "on",
              refundPolicy: text(f, "refundPolicy"),
              sport: text(f, "sport"),
              organizer: text(f, "organizer"),
              questions: text(f, "questions").split("\n").filter(Boolean),
              assignedAdmins: [user!.uid],
              duration: number(f, "duration"),
              buffer: number(f, "buffer"),
              dailyStartHour: number(f, "dailyStartHour"),
              dailyEndHour: number(f, "dailyEndHour"),
              eventType: text(f, "eventType"),
              ageGroup: text(f, "ageGroup"),
              genderCategory: text(f, "genderCategory"),
              divisionSummary: divisions.map((d) => d.name).join(" · "),
              courtIds: f.getAll("courtIds").map(String),
              blackouts: JSON.parse(text(f, "blackouts") || "[]"),
            };
            const result = await action("createEvent", {
              event,
              divisions: divisions.map((d) => ({
                ...d,
                ...(["koc", "doubles"].includes(competition)
                  ? {
                      format:
                        teamStage === "groups-playoffs"
                          ? "round-robin-playoffs"
                          : teamStage,
                    }
                  : {}),
                fee: d.fee === undefined ? undefined : Number(d.fee),
              })),
            });
            navigate(`/admin/events/${result.eventId}`);
          }}
        >
          <section hidden={step !== 0}>
            <h2>01 · The basics</h2>
            <Field label="Competition format">
              <select
                value={competition}
                onChange={(e) => {
                  setCompetition(e.target.value);
                  setTeamStage(
                    e.target.value === "doubles"
                      ? "round-robin"
                      : "groups-playoffs",
                  );
                  setDivisions([
                    {
                      ...defaultDivision,
                      ...(e.target.value !== "individual"
                        ? {
                            name: `${e.target.value.toUpperCase()} entries`,
                            format:
                              e.target.value === "ladder"
                                ? "single-elimination"
                                : e.target.value === "doubles"
                                  ? "round-robin"
                                  : "round-robin-playoffs",
                            capacity: 8,
                          }
                        : {}),
                    },
                  ]);
                }}
              >
                <option value="individual">Individual tournament</option>
                <option value="triace">TRIACE 2.0 team tournament</option>
                <option value="koc">Configurable KOC team competition</option>
                <option value="doubles">Doubles tournament</option>
                <option value="ladder">Singles or doubles ladder season</option>
              </select>
            </Field>
            {["koc", "doubles"].includes(competition) && (
              <Field label="Team tournament stages">
                <select
                  value={teamStage}
                  onChange={(e) => {
                    setTeamStage(e.target.value);
                    setDivisions((ds) =>
                      ds.map((d) => ({
                        ...d,
                        format:
                          e.target.value === "groups-playoffs"
                            ? "round-robin-playoffs"
                            : e.target.value,
                      })),
                    );
                  }}
                >
                  <option value="groups-playoffs">
                    Group stage and playoffs
                  </option>
                  <option value="round-robin">Round robin</option>
                  <option value="single-elimination">Knockout</option>
                </select>
              </Field>
            )}
            {competition !== "individual" && (
              <p className="notice">
                Capacity and fees apply per team. Review roster, scoring,
                eligibility and deadline policies in the draft event’s Rules tab
                before publishing.
              </p>
            )}
            {competition === "triace" && (
              <p className="notice">
                Three players per team. Configure lineup, reference and
                participation policies in the draft tournament’s Rules tab
                before publishing.
              </p>
            )}
            <div className="form-grid">
              {[
                ["name", "Event name", "Prosper Open Weekend"],
                ["venue", "Venue", "Prosper Premier Racquet Club"],
                ["location", "City & state", "Prosper, TX"],
                ["organizer", "Organizer", "PPRC Events Team"],
              ].map(([k, l, v]) => (
                <Field key={k} label={l}>
                  <input
                    name={k}
                    defaultValue={source?.[k] ?? v}
                    required={step === 0}
                  />
                </Field>
              ))}
            </div>
            <Field label="Event description">
              <textarea
                name="description"
                rows={4}
                defaultValue={
                  source?.description ??
                  "A welcoming weekend of competitive tennis, good sportsmanship and great community."
                }
              />
            </Field>
            <div className="form-grid">
              <Field label="Event type">
                <select
                  name="eventType"
                  defaultValue={source?.eventType ?? "Tournament"}
                >
                  {["Tournament", "Round robin", "Social"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Age group">
                <select
                  name="ageGroup"
                  defaultValue={source?.ageGroup ?? "All ages"}
                >
                  {["All ages", "Adult", "Junior"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Gender category">
                <select
                  name="genderCategory"
                  defaultValue={source?.genderCategory ?? "Open"}
                >
                  {["Open", "Male", "Female"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="Sport">
                <select name="sport" defaultValue={source?.sport ?? "Tennis"}>
                  <option>Tennis</option>
                  <option>Pickleball</option>
                </select>
              </Field>
              <Field label="Visibility">
                <select
                  name="visibility"
                  defaultValue={source?.visibility ?? "public"}
                >
                  <option value="public">Public</option>
                  <option value="private">Private · club members</option>
                </select>
              </Field>
              <Field label="Start date & time (UTC)">
                <input
                  type="datetime-local"
                  name="startDate"
                  key={`start-${competition}`}
                  defaultValue={source?.startDate?.slice(0, 16) ?? start}
                />
              </Field>
              <Field label="End date & time (UTC)">
                <input
                  type="datetime-local"
                  name="endDate"
                  key={`end-${competition}`}
                  defaultValue={source?.endDate?.slice(0, 16) ?? end}
                />
              </Field>
              <Field label="Event time zone">
                <select
                  name="timezone"
                  defaultValue={source?.timezone ?? "America/Chicago"}
                >
                  {[
                    "America/Chicago",
                    "America/New_York",
                    "America/Denver",
                    "America/Los_Angeles",
                    "UTC",
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Cover image (JPEG, PNG or WebP; under 5 MB)">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setCover(e.target.files?.[0] ?? null)}
              />
            </Field>
            <p className="muted">
              An original court illustration is used when no cover is uploaded.
            </p>
          </section>
          <section hidden={step !== 1}>
            <h2>02 · Registration</h2>
            <div className="form-grid">
              <Field label="Registration opens (UTC)">
                <input
                  name="registrationOpen"
                  type="datetime-local"
                  defaultValue={local(new Date(Date.now() - 60000))}
                />
              </Field>
              <Field label="Registration closes (UTC)">
                <input
                  name="registrationClose"
                  type="datetime-local"
                  defaultValue={local(new Date(Date.now() + 12 * 86400000))}
                />
              </Field>
              <Field label="Entry fee ($)">
                <input
                  name="fee"
                  type="number"
                  min="0"
                  defaultValue={(source?.fee ?? 4500) / 100}
                />
              </Field>
              <Field label="Total event capacity">
                <input
                  name="capacity"
                  type="number"
                  min="2"
                  max={
                    competition === "ladder"
                      ? 32
                      : competition !== "individual"
                        ? 16
                        : 128
                  }
                  defaultValue={source?.capacity ?? 16}
                />
              </Field>
            </div>
            <label className="check">
              <input
                name="waitlist"
                type="checkbox"
                defaultChecked={source?.waitlist ?? true}
              />
              Enable waitlist and automatic promotion
            </label>
            <label className="check">
              <input
                name="waiverRequired"
                type="checkbox"
                defaultChecked={source?.waiverRequired ?? true}
              />
              Require waiver acknowledgement
            </label>
            <Field label="Withdrawal & refund policy">
              <textarea
                name="refundPolicy"
                defaultValue={
                  source?.refundPolicy ??
                  "Full refund requested at least 72 hours before the event. Later withdrawals are reviewed by the event team."
                }
              />
            </Field>
            <Field label="Registration questions (one per line)">
              <textarea
                name="questions"
                defaultValue={
                  source?.questions?.join("\n") ??
                  "Do you have any scheduling constraints?"
                }
              />
            </Field>
          </section>
          <section hidden={step !== 2}>
            <h2>03 · Divisions</h2>
            {divisions.map((d, i) => (
              <div className="division-editor" key={i}>
                <div className="section-heading">
                  <h3>Division {i + 1}</h3>
                  {divisions.length > 1 && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setDivisions((ds) => ds.filter((_, j) => j !== i))
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="form-grid">
                  <Field label="Division name">
                    <input
                      value={d.name}
                      onChange={(e) => update(i, "name", e.target.value)}
                    />
                  </Field>
                  <Field label="Format">
                    <select
                      value={d.format}
                      disabled={competition !== "individual"}
                      onChange={(e) => update(i, "format", e.target.value)}
                    >
                      {formats.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </Field>
                  {[
                    ["capacity", "Capacity"],
                    ["minRating", "Minimum reference"],
                    ["maxRating", "Maximum reference"],
                    ["minAge", "Minimum age"],
                    ["maxAge", "Maximum age"],
                    ["groupSize", "Group size"],
                    ["qualifiers", "Playoff qualifiers per group"],
                  ]
                    .filter(
                      ([k]) =>
                        competition === "individual" ||
                        !["groupSize", "qualifiers"].includes(k),
                    )
                    .map(([k, l]) => (
                      <Field key={k} label={l}>
                        <input
                          type="number"
                          value={d[k]}
                          min="0"
                          onChange={(e) => update(i, k, Number(e.target.value))}
                        />
                      </Field>
                    ))}
                  <Field label="Gender category">
                    <select
                      value={d.gender}
                      onChange={(e) => update(i, "gender", e.target.value)}
                    >
                      {["Open", "Male", "Female"].map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </Field>
                  {competition === "individual" && (
                    <Field label="Third set">
                      <select
                        value={d.scoring}
                        onChange={(e) => update(i, "scoring", e.target.value)}
                      >
                        <option value="match-tiebreak">
                          10-point match tiebreak
                        </option>
                        <option value="standard">Full set</option>
                      </select>
                    </Field>
                  )}
                  <Field label="Eligibility notes">
                    <textarea
                      value={d.eligibilityNotes ?? ""}
                      onChange={(e) =>
                        update(i, "eligibilityNotes", e.target.value)
                      }
                    />
                  </Field>
                  {competition === "individual" && (
                    <Field label="Standings order (comma-separated)">
                      <input
                        value={(
                          d.tieBreakOrder ?? [
                            "wins",
                            "head-to-head",
                            "set-percentage",
                            "game-percentage",
                            "admin",
                          ]
                        ).join(",")}
                        onChange={(e) =>
                          update(
                            i,
                            "tieBreakOrder",
                            e.target.value.split(",").map((v) => v.trim()),
                          )
                        }
                      />
                    </Field>
                  )}
                  <Field label="Price override in cents (optional)">
                    <input
                      type="number"
                      value={d.fee ?? ""}
                      onChange={(e) =>
                        update(
                          i,
                          "fee",
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                        )
                      }
                    />
                  </Field>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="button secondary"
              disabled={competition !== "individual"}
              onClick={() =>
                setDivisions((ds) => [
                  ...ds,
                  { ...defaultDivision, name: `Division ${ds.length + 1}` },
                ])
              }
            >
              <Plus size={16} />
              Add division
            </button>
          </section>
          <section hidden={step !== 3}>
            <h2>04 · Scheduling</h2>
            <p>
              Choose available courts. The scheduler uses event-local daytime
              hours, match durations and blackout periods.
            </p>
            <div className="form-grid">
              <Field label="Daily start hour (event local, 0–23)">
                <input
                  name="dailyStartHour"
                  type="number"
                  min="0"
                  max="23"
                  defaultValue={source?.dailyStartHour ?? 8}
                />
              </Field>
              <Field label="Daily end hour (event local, 1–24)">
                <input
                  name="dailyEndHour"
                  type="number"
                  min="1"
                  max="24"
                  defaultValue={source?.dailyEndHour ?? 21}
                />
              </Field>
              <Field
                label={
                  competition === "triace"
                    ? "Encounter block duration (minutes)"
                    : "Match duration (minutes)"
                }
              >
                <input
                  key={competition}
                  name="duration"
                  type="number"
                  min="15"
                  max="240"
                  defaultValue={
                    source?.duration ??
                    (["triace", "koc"].includes(competition) ? 180 : 75)
                  }
                />
              </Field>
              <Field label="Buffer (minutes)">
                <input
                  name="buffer"
                  type="number"
                  min="0"
                  max="60"
                  defaultValue={source?.buffer ?? 15}
                />
              </Field>
            </div>
            <div className="court-options">
              {courts
                .filter((c) => c.active)
                .map((c) => (
                  <label className="check" key={c.id}>
                    <input
                      name="courtIds"
                      type="checkbox"
                      value={c.id}
                      defaultChecked={source?.courtIds?.includes(c.id) ?? true}
                    />
                    {c.name}
                  </label>
                ))}
            </div>
            <Field label="Blackout periods (JSON array of UTC start/end timestamps)">
              <textarea
                name="blackouts"
                defaultValue={JSON.stringify(source?.blackouts ?? [])}
              />
            </Field>
          </section>
          <section hidden={step !== 4}>
            <h2>05 · Ready for the first serve?</h2>
            <p>
              Your event is saved as a draft. Review the public preview from the
              event workspace, then publish when you are ready.
            </p>
            <ul className="checklist">
              <li>
                <CheckCircle2 /> Event dates and registration window validated
                on the server
              </li>
              <li>
                <CheckCircle2 /> Eligibility and division capacity validated
                before payment
              </li>
              <li>
                <CheckCircle2 /> Waiver and refund policy saved with event
                configuration
              </li>
              <li>
                <CheckCircle2 /> All changes recorded in the club audit history
              </li>
            </ul>
            <p className="notice">
              Check your entries in earlier steps. The server returns specific
              validation errors if anything is missing.
            </p>
          </section>
          {step > 0 && (
            <button
              className="text-button"
              type="button"
              onClick={() => setStep((s) => s - 1)}
            >
              ← Previous step
            </button>
          )}
        </Form>
      </Panel>
    </div>
  );
}
