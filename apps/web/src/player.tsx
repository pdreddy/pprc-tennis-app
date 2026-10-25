import { LadderTournament } from "./ladder";
import { useEffect, useState } from "react";
import { ScoreForm } from "./scoring";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getBlob } from "firebase/storage";
import {
  CalendarDays,
  MapPin,
  ArrowLeft,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { useSession, useEvent, useList, useAction } from "./context";
import { db, storage, enablePush, getOne } from "./firebase";
import {
  Panel,
  Dialog,
  Field,
  Form,
  Action,
  Badge,
  Empty,
  CoverArt,
  date,
  money,
  text,
} from "./ui";
import { matchesToIcs, type Entity } from "@pprc/shared";
import { TriaceTournament, TeamSchedule, TeamHistory } from "./teams";
import { OnboardingSteps } from "./club";
import {
  CalendarViews,
  RescheduleForm,
  RescheduleRequests,
} from "./operations";
import { call } from "./firebase";
export function EventDetail() {
  const { eventId = "" } = useParams();
  const data = useEvent(eventId);
  const { event, divisions, draws, matches, loading, error } = data;
  const [tab, setTab] = useState("Overview");
  const profiles = useList("publicProfiles").data ?? [];
  const name = (id: string) =>
    profiles.find((p) => p.id === id)?.displayName ??
    (id || "To be determined");
  if (loading)
    return (
      <div className="page" role="status">
        Loading event…
      </div>
    );
  if (error)
    return (
      <div className="page error" role="alert">
        {error.message}
      </div>
    );
  if (!event) return <Empty title="Event not found" />;
  if (event.competition === "ladder")
    return <LadderTournament eventId={eventId} />;
  if (["triace", "koc", "doubles"].includes(event.competition))
    return <TriaceTournament eventId={eventId} />;
  return (
    <div className="page">
      <Link className="text-link" to="/events">
        <ArrowLeft size={16} /> All events
      </Link>
      <div className="event-hero">
        <CoverArt path={event.coverPath} variant={event.name.length} />
        <div className="event-hero-content">
          <Badge>{event.status}</Badge>
          <h1>{event.name}</h1>
          <p>
            <MapPin size={17} />
            {event.venue} · {event.location}
          </p>
          <p>
            <CalendarDays size={17} />
            {date(event.startDate, event.timezone, true)} —{" "}
            {date(event.endDate, event.timezone, true)}
          </p>
        </div>
      </div>
      <div className="tabs" role="navigation" aria-label="Event sections">
        {["Overview", "Divisions", "Draws", "Schedule", "Results"].map((t) => (
          <button
            aria-pressed={tab === t}
            className={tab === t ? "active" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="detail-layout">
        <div>
          {tab === "Overview" && (
            <>
              <Panel title="The competition. The community.">
                <p className="prose">{event.description}</p>
                <div className="info-grid">
                  <div>
                    <small>ORGANIZER</small>
                    <strong>{event.organizer}</strong>
                  </div>
                  <div>
                    <small>VENUE</small>
                    <strong>{event.venue}</strong>
                  </div>
                  <div>
                    <small>REGISTRATION CLOSES</small>
                    <strong>
                      {date(event.registrationClose, event.timezone, true)}
                    </strong>
                  </div>
                  <div>
                    <small>EVENT TIME ZONE</small>
                    <strong>{event.timezone}</strong>
                  </div>
                </div>
              </Panel>
              <Panel title="Good to know">
                <p>
                  No-ad scoring, tiebreak at 6–6. See division rules for
                  third-set format.
                </p>
                <h3>Withdrawal & refund policy</h3>
                <p>{event.refundPolicy}</p>
                <p>
                  External ratings are player-provided or admin-verified
                  reference values. PPRC results are independent.
                </p>
              </Panel>
            </>
          )}
          {(tab === "Divisions" || tab === "Overview") && (
            <Panel title="Find your division">
              {divisions.map((d) => (
                <div className="division-row" key={d.id}>
                  <div>
                    <h3>{d.name}</h3>
                    <p>
                      {d.format.replaceAll("-", " ")} · {d.gender} ·{" "}
                      {d.capacity} places
                    </p>
                    <small>
                      {d.eligibilityNotes} Reference {d.minRating}–{d.maxRating}{" "}
                      · Ages {d.minAge}–{d.maxAge} ·{" "}
                      {d.scoring === "match-tiebreak"
                        ? "10-point match tiebreak"
                        : "Best of 3 full sets"}
                    </small>
                  </div>
                  <div>
                    <strong>{money(d.fee ?? event.fee)}</strong>
                    {event.status === "Registration Open" ? (
                      <Link
                        className="button primary small"
                        to={`/register/${event.id}/${d.id}`}
                      >
                        Register <ArrowUpRight size={15} />
                      </Link>
                    ) : (
                      <Badge>{event.status}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </Panel>
          )}
          {tab === "Draws" &&
            (!draws.length ? (
              <Empty title="The draw is coming soon" />
            ) : (
              draws.map((draw) => (
                <Panel
                  key={draw.id}
                  title={`${divisions.find((d) => d.id === draw.divisionId)?.name ?? "Division"} · ${draw.phase}`}
                >
                  <div className="bracket">
                    {[
                      ...new Set(
                        matches
                          .filter((m) => m.drawId === draw.id)
                          .map((m) => m.round),
                      ),
                    ]
                      .sort()
                      .map((round) => (
                        <div className="bracket-round" key={round}>
                          <p className="eyebrow">ROUND {round}</p>
                          {matches
                            .filter(
                              (m) => m.drawId === draw.id && m.round === round,
                            )
                            .map((m) => (
                              <div className="bracket-match" key={m.id}>
                                <p
                                  className={m.winner === m.p1 ? "winner" : ""}
                                >
                                  {name(m.p1)} {m.winner === m.p1 ? "✓" : ""}
                                </p>
                                <p
                                  className={m.winner === m.p2 ? "winner" : ""}
                                >
                                  {name(m.p2)} {m.winner === m.p2 ? "✓" : ""}
                                </p>
                                <small>{m.status}</small>
                              </div>
                            ))}
                        </div>
                      ))}
                  </div>
                  {draw.standings?.map(
                    ({ rows }: { rows: Entity[] }, i: number) => (
                      <div key={i}>
                        <h3>Group {i + 1} standings</h3>
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
                                <th>W–L</th>
                                <th>Sets won</th>
                                <th>Games won</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => (
                                <tr key={r.playerId}>
                                  <td>
                                    {name(r.playerId)}{" "}
                                    {r.tied && (
                                      <Badge>Resolution pending</Badge>
                                    )}
                                  </td>
                                  <td>
                                    {r.wins}–{r.losses}
                                  </td>
                                  <td>
                                    {r.setsPlayed
                                      ? Math.round(
                                          (r.setsWon / r.setsPlayed) * 100,
                                        )
                                      : 0}
                                    %
                                  </td>
                                  <td>
                                    {r.gamesPlayed
                                      ? Math.round(
                                          (r.gamesWon / r.gamesPlayed) * 100,
                                        )
                                      : 0}
                                    %
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ),
                  )}
                </Panel>
              ))
            ))}
          {tab === "Schedule" && (
            <MatchList
              matches={matches.filter((m) => m.scheduledAt)}
              timezone={event.timezone}
            />
          )}{" "}
          {tab === "Results" && (
            <MatchList
              matches={matches.filter((m) => m.status === "Final")}
              timezone={event.timezone}
              results={data.results}
            />
          )}
        </div>
        <aside>
          <Panel title="Your next great match">
            <p>Secure your spot and be part of the PPRC community.</p>
            <div className="entry-price">
              <strong>{money(event.fee)}</strong>
              <span>starting entry fee</span>
            </div>
            <a
              href="#division-help"
              onClick={() => setTab("Divisions")}
              className="button primary full"
            >
              Choose a division <ArrowUpRight size={17} />
            </a>
            <p id="division-help" className="muted">
              <ShieldCheck size={15} /> Secure registration · No card details
              stored
            </p>
            <small>
              Waitlist{" "}
              {event.waitlist ? "available when full" : "not available"}.
              Approval and seeding are managed by the event team.
            </small>
          </Panel>
          {data.admin && (
            <Link
              className="button secondary full"
              to={`/admin/events/${event.id}`}
            >
              Manage this event
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
export function Registration() {
  const { eventId = "", divisionId = "" } = useParams();
  const { event, divisions, error } = useEvent(eventId);
  const { profile, user } = useSession();
  const [waiver, setWaiver] = useState<File | null>(null);
  const action = useAction();
  const navigate = useNavigate();
  const division = divisions.find((d) => d.id === divisionId);
  if (error) return <div className="page error">{error.message}</div>;
  if (!event || !division)
    return (
      <div className="page" role="status">
        Loading registration…
      </div>
    );
  return (
    <div className="page narrow">
      <p className="eyebrow">YOUR PLACE ON COURT</p>
      <h1>Make it official.</h1>
      <p className="lead">
        {event.name} · {division.name}
      </p>
      <Panel title="Registration details">
        <p>
          {date(event.startDate, event.timezone, true)} · {event.venue}
        </p>
        <h2>{money(division.fee ?? event.fee)}</h2>
        {!profile ? (
          <p>
            Create your <Link to="/profile">player profile</Link> before
            registering.
          </p>
        ) : (
          <Form
            label="Reserve my place"
            onSubmit={async (f) => {
              const answers = Object.fromEntries(
                event.questions.map((q: string) => [q, text(f, q)]),
              );
              let waiverPath;
              if (waiver) {
                waiverPath = `waivers/${eventId}/${user!.uid}/${crypto.randomUUID()}.pdf`;
                await uploadBytes(ref(storage, waiverPath), waiver, {
                  contentType: "application/pdf",
                });
              }
              await action("registerForDivision", {
                eventId,
                divisionId,
                waiver: f.get("waiver") === "on",
                answers,
                ...(waiverPath ? { waiverPath } : {}),
              });
              navigate("/my-events");
            }}
          >
            <p>
              Registering as <strong>{profile.displayName}</strong>
            </p>
            {event.questions.map((q: string) => (
              <Field key={q} label={q}>
                <input name={q} required maxLength={2000} />
              </Field>
            ))}
            <Field label="Optional signed waiver PDF (under 10 MB)">
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setWaiver(e.target.files?.[0] ?? null)}
              />
            </Field>
            <label className="check">
              <input
                name="waiver"
                type="checkbox"
                required={event.waiverRequired}
              />
              I acknowledge the risks of racquet sports and accept the event
              waiver and refund policy.
            </label>
            <p className="muted">{event.refundPolicy}</p>
            <p>
              When a division is full, eligible players join its waitlist. You
              will not be charged for a waitlist place.
            </p>
          </Form>
        )}
      </Panel>
    </div>
  );
}
export function MyEvents() {
  const { user } = useSession();
  const regs = useList("registrations", [["playerId", "==", user!.uid]]);
  const payments =
    useList("payments", [["playerId", "==", user!.uid]]).data ?? [];
  const action = useAction();
  const [checkout, setCheckout] = useState<{
    paymentId: string;
    eventId: string;
  } | null>(null);
  return (
    <div className="page">
      <p className="eyebrow">YOUR COMPETITION CALENDAR</p>
      <h1>My events</h1>
      <p className="lead">A spot to play. A match to look forward to.</p>
      {regs.error && (
        <p role="alert" className="error">
          {regs.error.message}
        </p>
      )}
      {regs.isLoading ? (
        <p role="status">Loading registrations…</p>
      ) : !regs.data?.length ? (
        <Empty title="Your next event is waiting">
          <Link to="/events">Find an event and get in the game.</Link>
        </Empty>
      ) : (
        <div className="registration-grid">
          {regs.data.map((r) => (
            <RegistrationReceipt
              key={r.id}
              r={r}
              payments={payments}
              onCheckout={setCheckout}
            />
          ))}
        </div>
      )}
      {checkout && (
        <Dialog title="Development checkout" onClose={() => setCheckout(null)}>
          <p>
            This simulator uses no card details and runs only in the Firebase
            emulator.
          </p>
          <Action
            variant="primary"
            onClick={async () => {
              await action("confirmDevelopmentPayment", checkout);
              setCheckout(null);
            }}
          >
            Simulate successful payment
          </Action>
          <button
            className="button secondary"
            onClick={() => setCheckout(null)}
          >
            Cancel
          </button>
        </Dialog>
      )}
    </div>
  );
}
function RegistrationReceipt({
  r,
  payments,
  onCheckout,
}: {
  r: Entity;
  payments: Entity[];
  onCheckout: (value: { paymentId: string; eventId: string }) => void;
}) {
  const action = useAction();
  const { user } = useSession();
  const event = useQuery({
    queryKey: ["event", r.eventId, user?.uid],
    queryFn: () => getOne("events", r.eventId!),
  });
  const closed = ["Completed", "Cancelled"].includes(event.data?.status ?? "");
  return (
    <Panel
      title={
        (r.eventName ?? event.data?.name ?? r.displayName) +
        " · " +
        (r.divisionName ?? "Registration")
      }
    >
      <Badge>{r.state}</Badge>
      <p>
        <Link to={`/events/${r.eventId}`}>View event details →</Link>
      </p>
      <small>Receipt / registration #{r.id.slice(0, 8)}</small>
      <p>
        Check-in: {r.checkIn} · {r.seed ? `Seed ${r.seed}` : "Seed pending"}
      </p>
      {payments
        .filter((p) => p.registrationId === r.id)
        .map((p) => (
          <p key={p.id}>
            {money(p.amount)} · {p.state} · Receipt {p.id.slice(0, 8)}
          </p>
        ))}
      {r.state === "Pending Payment" && !closed && (
        <Action
          variant="primary"
          onClick={async () => {
            const response = await action("startCheckout", {
              eventId: r.eventId,
              registrationId: r.id,
            });
            if (response.development)
              onCheckout({
                paymentId: response.paymentId,
                eventId: r.eventId!,
              });
            else window.location.assign(response.url);
          }}
        >
          Complete payment
        </Action>
      )}
      {["Registered", "Approved", "Pending Payment", "Waitlisted"].includes(
        r.state,
      ) &&
        !closed && (
          <Form
            label="Withdraw registration"
            onSubmit={(f) =>
              action("cancelRegistration", {
                eventId: r.eventId,
                registrationId: r.id,
                reason: text(f, "reason"),
              })
            }
          >
            <Field label="Withdrawal reason">
              <input name="reason" required minLength={5} />
            </Field>
          </Form>
        )}
    </Panel>
  );
}
export function MatchList({
  matches,
  timezone = "America/Chicago",
  results = [],
}: {
  matches: Entity[];
  timezone?: string;
  results?: Entity[];
}) {
  const profiles = useList("publicProfiles").data ?? [],
    courts = useList("courts").data ?? [];
  const name = (id: string) =>
    profiles.find((p) => p.id === id)?.displayName ?? "TBD";
  return !matches.length ? (
    <Empty title="No matches to show yet" />
  ) : (
    <div className="match-list">
      {[...matches]
        .sort((a, b) =>
          (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""),
        )
        .map((m) => (
          <article className="panel match-row" key={m.id}>
            <div className="match-date">
              <CalendarDays size={20} />
              <strong>
                {m.scheduledAt
                  ? date(m.scheduledAt, timezone, true)
                  : "Time to be announced"}
              </strong>
              <small>
                {courts.find((c) => c.id === m.courtId)?.name ?? "Court TBD"}
              </small>
            </div>
            <div>
              <h3>
                {name(m.p1)} <span className="muted">vs</span> {name(m.p2)}
              </h3>
              <p>
                Round {m.round} ·{" "}
                <Link to={`/events/${m.eventId}`}>Event details</Link>
              </p>
              {results
                .filter((r) => r.matchId === m.id && r.state === "Final")
                .map((r) => (
                  <p key={r.id}>
                    <strong>
                      {r.score.sets
                        .map((s: any) => `${s.a}–${s.b}`)
                        .join("  ") || r.score.outcome}
                    </strong>{" "}
                    · Winner: {name(r.score.winner)}
                  </p>
                ))}
            </div>
            <Badge>{m.status}</Badge>
          </article>
        ))}
    </div>
  );
}
// Downloads the player's scheduled matches as an .ics file. Times come from the
// server; event length and location come from each event. A match whose event
// cannot be read is left out, and the count of left-out matches is shown.
function CalendarExport({ matches }: { matches: Entity[] }) {
  const scheduled = matches.filter((m) => m.scheduledAt);
  const eventIds = [...new Set(scheduled.map((m) => String(m.eventId)))];
  const events = useQuery({
    queryKey: ["calendarEvents", eventIds],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          eventIds.map(async (id) => [
            id,
            await getOne("events", id).catch(() => null),
          ]),
        ),
      ) as Record<string, Entity | null>,
    enabled: eventIds.length > 0,
  });
  const map = events.data ?? {};
  const readable = scheduled.filter((m) => map[String(m.eventId)]);
  const download = () => {
    const ics = matchesToIcs(
      "PPRC matches",
      readable.map((m) => {
        const event = map[String(m.eventId)]!;
        return {
          id: m.id,
          title: `${event.name}: Round ${m.round}`,
          start: String(m.scheduledAt),
          minutes: Number(event.duration ?? 75),
          location: String(event.location ?? ""),
        };
      }),
    );
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "pprc-matches.ics";
    link.click();
    URL.revokeObjectURL(url);
  };
  const skipped = scheduled.length - readable.length;
  return (
    <div className="calendar-export">
      <button
        type="button"
        className="button secondary"
        onClick={download}
        disabled={events.isLoading}
      >
        Download calendar (.ics)
      </button>
      {skipped > 0 && (
        <p className="muted" role="status">
          {skipped} scheduled {skipped === 1 ? "match is" : "matches are"} not
          included because the event could not be read.
        </p>
      )}
    </div>
  );
}
// Match center: upcoming and completed matches for the signed-in player.
// Completed means the server has finalized the match; nothing here is live.
function MatchCenterTabs({ matches }: { matches: Entity[] }) {
  const [tab, setTab] = useState<"upcoming" | "completed">("upcoming");
  const completed = matches.filter((m) => m.status === "Final");
  const upcoming = matches.filter((m) => m.status !== "Final");
  const shown = tab === "completed" ? completed : upcoming;
  return (
    <section aria-label="Match center">
      <div className="group-tabs" role="group" aria-label="Match status">
        {(
          [
            ["upcoming", "Upcoming", upcoming.length],
            ["completed", "Completed", completed.length],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            className="group-tab"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label} <span className="filter-count">{count}</span>
          </button>
        ))}
      </div>
      <MatchList matches={shown} />
    </section>
  );
}
export function Schedule() {
  const { user } = useSession(),
    action = useAction();
  const a = useList("matches", [
      ["p1", "==", user!.uid],
      ["published", "==", true],
    ]),
    b = useList("matches", [
      ["p2", "==", user!.uid],
      ["published", "==", true],
    ]);
  return (
    <div className="page">
      <p className="eyebrow">PLAN YOUR PLAY</p>
      <h1>My match schedule</h1>
      <p className="lead">Times are shown in the event’s local timezone.</p>
      <CalendarExport matches={[...(a.data ?? []), ...(b.data ?? [])]} />
      <CalendarViews
        items={[...(a.data ?? []), ...(b.data ?? [])]
          .filter((m) => m.scheduledAt)
          .map((m) => ({
            id: m.id,
            title: `Round ${m.round}`,
            start: String(m.scheduledAt),
            location: m.courtId ? String(m.courtId) : undefined,
          }))}
      />
      <RescheduleRequests />
      <Panel title="Request a new time">
        {[...(a.data ?? []), ...(b.data ?? [])]
          .filter(
            (m) => m.p1 && m.p2 && m.scheduledAt && m.status === "Scheduled",
          )
          .map((m) => (
            <details key={m.id}>
              <summary>
                Round {m.round} · {m.id}
              </summary>
              <RescheduleForm match={m} />
            </details>
          ))}
      </Panel>
      <TeamSchedule />
      <MatchCenterTabs matches={[...(a.data ?? []), ...(b.data ?? [])]} />
      <Panel title="Submit a match score">
        {[...(a.data ?? []), ...(b.data ?? [])]
          .filter((m) => m.p1 && m.p2 && m.status === "Scheduled")
          .map((m) => (
            <details key={m.id}>
              <summary>
                Round {m.round} · {m.id}
              </summary>
              <ScoreForm
                label="Submit score for opponent confirmation"
                match={m}
                onSubmit={(p) =>
                  action("submitScore", {
                    eventId: m.eventId,
                    matchId: m.id,
                    version: m.version,
                    ...p,
                    finalize: false,
                  })
                }
              />
            </details>
          ))}
      </Panel>
      <PlayerScores />
    </div>
  );
}
function PlayerScores() {
  const { user } = useSession();
  const results =
      useList("matchResults", [["participants", "array-contains", user!.uid]])
        .data ?? [],
    action = useAction();
  return (
    <Panel title="Score confirmations">
      {!results.length && <p>No scores awaiting your attention.</p>}
      {results
        .filter((r) => r.state === "Submitted" || r.correctionRequested)
        .map((r) => (
          <div className="division-row" key={r.id}>
            <div>
              <strong>
                {r.score.sets.map((s: any) => `${s.a}–${s.b}`).join(" ") ||
                  r.score.outcome}
              </strong>
              <p>
                Version {r.version} · {r.state}
              </p>
            </div>
            <div>
              {r.submittedBy !== user!.uid && r.state === "Submitted" && (
                <Action
                  onClick={() =>
                    action("finalizeScore", {
                      eventId: r.eventId,
                      resultId: r.id,
                    })
                  }
                >
                  Confirm score
                </Action>
              )}
              <Form
                label="Request correction"
                onSubmit={(f) =>
                  action("requestScoreCorrection", {
                    eventId: r.eventId,
                    resultId: r.id,
                    reason: text(f, "reason"),
                  })
                }
              >
                <Field label="Correction reason">
                  <input required minLength={5} name="reason" />
                </Field>
              </Form>
            </div>
          </div>
        ))}
    </Panel>
  );
}
export function Results() {
  const { user } = useSession();
  const events = useList("events", [
    ["visibility", "==", "public"],
    ["status", "==", "Completed"],
  ]);
  const personal = useList(
    "matchResults",
    [["participants", "array-contains", user?.uid ?? "guest"]],
    !!user,
  );
  const finals = personal.data?.filter((r) => r.state === "Final") ?? [];
  return (
    <div className="page">
      <p className="eyebrow">THE GAME, RECORDED</p>
      <h1>Results & player history</h1>
      {user && (
        <Link className="button secondary" to="/dashboard">
          My performance dashboard
        </Link>
      )}
      <p className="lead">
        Every match is part of your story. PPRC results stand on their own.
      </p>
      {user && (
        <Panel title="My match history">
          {!finals.length ? (
            <p>Your finalized matches will appear here.</p>
          ) : (
            finals.map((r) => (
              <div className="division-row" key={r.id}>
                <div>
                  <Badge>
                    {r.score.winner === user.uid ? "Won" : "Played"}
                  </Badge>
                  <p>
                    {r.score.sets.map((s: any) => `${s.a}–${s.b}`).join(" ") ||
                      r.score.outcome}{" "}
                    · Version {r.version}
                  </p>
                </div>
                <Link to={`/events/${r.eventId}`}>View event →</Link>
              </div>
            ))
          )}
        </Panel>
      )}
      <h2>Completed events</h2>
      {user && <TeamHistory />}
      <div className="event-grid">
        {events.data?.map((e) => (
          <Panel key={e.id} title={e.name}>
            <Badge>Completed</Badge>
            <p>
              {date(e.startDate)} · {e.location}
            </p>
            <Link className="text-link" to={`/events/${e.id}`}>
              View results <ArrowUpRight size={16} />
            </Link>
          </Panel>
        ))}
      </div>
    </div>
  );
}
// Read-only summary at the top of the profile. Ratings are supplied
// references, never official UTR values. A missing rating shows "Not
// provided"; an empty record shows "No confirmed results yet", not zero.
function ProfileSummary() {
  const { profile, user } = useSession();
  const record = useQuery({
    queryKey: ["myPerformance", user?.uid],
    queryFn: () => call("getMyPerformance"),
    enabled: !!user && !!profile,
    staleTime: 60000,
  });
  const teams = useList("teams", [["memberIds", "array-contains", user!.uid]]);
  const initials = (profile?.displayName ?? "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const rating = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(2)
      : "Not provided";
  const summary = record.data?.summary;
  return (
    <section className="profile-summary" aria-label="Profile summary">
      <div className="profile-summary-head">
        <span className="profile-avatar" aria-hidden="true">
          {initials}
        </span>
        <div>
          <h2>{profile?.displayName ?? "Your name"}</h2>
          <p className="muted">
            {[
              profile?.city,
              profile?.visibility === "public"
                ? "Public profile"
                : "Private profile",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
      <div className="stat-grid">
        <div className="stat-card">
          <span className="muted">Singles</span>
          <strong>{rating(profile?.singlesUtr)}</strong>
        </div>
        <div className="stat-card">
          <span className="muted">Doubles</span>
          <strong>{rating(profile?.doublesUtr)}</strong>
        </div>
      </div>
      <p className="muted">
        Supplied reference ({profile?.ratingSource ?? "Player provided"}), not
        an official UTR rating.
      </p>
      <dl className="profile-facts">
        <dt>Confirmed record</dt>
        <dd>
          {record.error ? (
            <span role="alert">Could not load results.</span>
          ) : record.isLoading ? (
            <span role="status">Loading…</span>
          ) : summary && summary.total > 0 ? (
            `${summary.wins} wins, ${summary.losses} losses (${summary.total} confirmed)`
          ) : (
            "No confirmed results yet"
          )}
        </dd>
        <dt>Teams</dt>
        <dd>
          {teams.error ? (
            <span role="alert">Could not load teams.</span>
          ) : teams.isLoading ? (
            <span role="status">Loading…</span>
          ) : teams.data?.length ? (
            teams.data.map((t) => String(t.name ?? "Team")).join(", ")
          ) : (
            "Not on a team"
          )}
        </dd>
      </dl>
    </section>
  );
}
const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Private availability for scheduling. Only the player and club administrators
// can read it; the server validates every field before saving.
function AvailabilityForm() {
  const { user } = useSession(),
    action = useAction();
  const saved = useList("availability", [["playerId", "==", user!.uid]]);
  const current = saved.data?.[0] as
    | {
        weekdays?: number[];
        windows?: { start: string; end: string }[];
        unavailableDates?: string[];
        notes?: string;
        updatedAt?: { seconds: number };
      }
    | undefined;
  const slot = current?.windows?.[0];
  return (
    <section aria-label="Availability">
      <Panel title="Availability">
        <p className="muted">
          Only you and club administrators can see this. It is used to propose
          match times, never shown on your public profile.
        </p>
        {saved.error && (
          <p className="error" role="alert">
            Could not load your availability: {saved.error.message}
          </p>
        )}
        <Form
          key={saved.isLoading ? "availability-loading" : "availability-loaded"}
          label="Save availability"
          onSubmit={(f) =>
            action("saveAvailability", {
              availability: {
                weekdays: weekdayNames
                  .map((_, i) => (f.get(`day-${i}`) === "on" ? i : -1))
                  .filter((i) => i >= 0),
                windows:
                  text(f, "start") && text(f, "end")
                    ? [{ start: text(f, "start"), end: text(f, "end") }]
                    : [],
                unavailableDates: text(f, "dates")
                  .split(",")
                  .map((d) => d.trim())
                  .filter(Boolean),
                notes: text(f, "notes"),
              },
            })
          }
        >
          <fieldset>
            <legend>Preferred days</legend>
            <div className="check-grid">
              {weekdayNames.map((name, i) => (
                <label className="check" key={name}>
                  <input
                    type="checkbox"
                    name={`day-${i}`}
                    defaultChecked={current?.weekdays?.includes(i)}
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Preferred start time">
            <input name="start" type="time" defaultValue={slot?.start ?? ""} />
          </Field>
          <Field label="Preferred end time">
            <input name="end" type="time" defaultValue={slot?.end ?? ""} />
          </Field>
          <Field label="Unavailable dates (YYYY-MM-DD, comma separated)">
            <input
              name="dates"
              defaultValue={(current?.unavailableDates ?? []).join(", ")}
            />
          </Field>
          <Field label="Scheduling notes">
            <input
              name="notes"
              maxLength={300}
              defaultValue={current?.notes ?? ""}
            />
          </Field>
        </Form>
      </Panel>
    </section>
  );
}
export function Profile() {
  const { profile, user } = useSession(),
    action = useAction();
  const [photo, setPhoto] = useState<File | null>(null);
  return (
    <div className="page narrow">
      <p className="eyebrow">PART OF THE CLUB</p>
      <h1>My player profile</h1>
      <ProfileSummary />
      <AvailabilityForm />
      <Link className="button secondary" to="/dashboard">
        View my performance
      </Link>
      <nav className="quick-links" aria-label="More places">
        <Link to="/teams">My teams</Link>
        <Link to="/clubs/pprc">Club</Link>
        <Link to="/players">Players</Link>
        <Link to="/results">Results</Link>
      </nav>
      <p className="lead">A little about you. A better match for everyone.</p>
      <OnboardingSteps />
      <Panel>
        {profile?.photoPath && <OwnPhoto path={profile.photoPath} />}
        <p className="muted">
          Your player UID: <code>{user?.uid}</code>. Share it with a captain to
          receive a team invitation.
        </p>
        <Form
          key={profile?.updatedAt?.seconds ?? "new"}
          label="Save player profile"
          onSubmit={async (f) => {
            let photoPath = profile?.photoPath;
            if (photo) {
              photoPath = `photos/${user!.uid}/${crypto.randomUUID()}`;
              await uploadBytes(ref(storage, photoPath), photo, {
                contentType: photo.type,
              });
            }
            const external = text(f, "externalRating");
            await action("saveProfile", {
              profile: {
                displayName: text(f, "displayName"),
                city: text(f, "city"),
                preferredSport: text(f, "preferredSport"),
                tennisLevel: text(f, "tennisLevel"),
                ...(external ? { externalRating: Number(external) } : {}),
                ...(text(f, "singlesUtr")
                  ? { singlesUtr: Number(text(f, "singlesUtr")) }
                  : {}),
                ...(text(f, "doublesUtr")
                  ? { doublesUtr: Number(text(f, "doublesUtr")) }
                  : {}),
                ratingSource: "Player provided",
                handedness: text(f, "handedness"),
                availability: text(f, "availability"),
                emergencyContact: text(f, "emergencyContact"),
                visibility: text(f, "visibility"),
                notificationPreferences: {
                  inApp: true,
                  push: f.get("push") === "on",
                },
                ...(text(f, "birthDate")
                  ? { birthDate: text(f, "birthDate") }
                  : {}),
                gender: text(f, "gender"),
                ...(photoPath ? { photoPath } : {}),
              },
            });
          }}
        >
          {[
            ["displayName", "Display name"],
            ["city", "City"],
            ["tennisLevel", "Playing level"],
            ["availability", "Availability"],
            ["emergencyContact", "Emergency contact (optional)"],
          ].map(([k, label]) => (
            <Field key={k} label={label}>
              <input
                name={k}
                defaultValue={profile?.[k] ?? ""}
                required={k === "displayName"}
                maxLength={k === "availability" ? 500 : 300}
              />
            </Field>
          ))}
          <div className="form-grid">
            <Field label="Date of birth (for eligibility)">
              <input
                type="date"
                name="birthDate"
                defaultValue={profile?.birthDate}
              />
            </Field>
            <Field label="Gender category">
              <select name="gender" defaultValue={profile?.gender ?? "Other"}>
                {["Other", "Male", "Female"].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
            <Field label="Preferred sport">
              <select
                name="preferredSport"
                defaultValue={profile?.preferredSport ?? "Tennis"}
              >
                <option>Tennis</option>
                <option>Pickleball</option>
              </select>
            </Field>
            <Field label="Handedness">
              <select
                name="handedness"
                defaultValue={profile?.handedness ?? "Right"}
              >
                {["Right", "Left", "Ambidextrous"].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
            <Field
              label="External rating reference (optional)"
              hint="Informational only. PPRC does not calculate or submit UTR ratings."
            >
              <input
                name="externalRating"
                type="number"
                min="0"
                max="20"
                step="0.01"
                defaultValue={profile?.externalRating}
              />
            </Field>
            {["singlesUtr", "doublesUtr"].map((k) => (
              <Field
                key={k}
                label={
                  k === "singlesUtr"
                    ? "Singles UTR reference"
                    : "Doubles UTR reference"
                }
                hint="TRIACE uses the higher reference per player; existing external reference is the fallback."
              >
                <input
                  name={k}
                  type="number"
                  min="0"
                  max="20"
                  step="0.01"
                  defaultValue={profile?.[k]}
                />
              </Field>
            ))}
            <Field label="Profile visibility">
              <select
                name="visibility"
                defaultValue={profile?.visibility ?? "public"}
              >
                <option value="public">Public name & playing level</option>
                <option value="private">Private profile</option>
              </select>
            </Field>
          </div>
          <p className="muted">
            Reference source: {profile?.ratingSource ?? "Player provided"}{" "}
            {profile?.ratingVerifiedAt && "· Verification date recorded"}
          </p>
          <Field label="Player photo (JPEG, PNG or WebP; under 5 MB)">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            />
          </Field>
          <label className="check">
            <input
              name="push"
              type="checkbox"
              defaultChecked={profile?.notificationPreferences?.push}
            />
            Enable push notification preference
          </label>
        </Form>
        <Action onClick={enablePush}>
          Enable notifications on this device
        </Action>
      </Panel>
      <Panel title="Your data, your choice">
        <p>
          Deletion requests are reviewed by the club; match records and
          financial audit requirements may require limited retention.
        </p>
        <Action onClick={() => action("requestAccountDeletion")}>
          Request account deletion
        </Action>
      </Panel>
    </div>
  );
}
// Player choices for in-app and push alerts, reminders and quiet hours. The
// server stores them on the player's own profile and the reminder job reads them.
function NotificationPreferencesForm() {
  const { profile } = useSession(),
    action = useAction();
  const saved = (profile?.notificationPreferences ?? {}) as {
    inApp?: boolean;
    push?: boolean;
    reminders?: boolean;
    quietStart?: string | null;
    quietEnd?: string | null;
  };
  return (
    <Panel title="Notification preferences">
      <p className="muted">
        Reminders are held during quiet hours. Quiet hours can cross midnight.
      </p>
      <Form
        key={profile?.updatedAt?.seconds ?? "prefs"}
        label="Save preferences"
        onSubmit={(f) =>
          action("saveNotificationPreferences", {
            preferences: {
              inApp: f.get("inApp") === "on",
              push: f.get("push") === "on",
              reminders: f.get("reminders") === "on",
              quietStart: text(f, "quietStart") || null,
              quietEnd: text(f, "quietEnd") || null,
            },
          })
        }
      >
        <label className="check">
          <input
            type="checkbox"
            name="inApp"
            defaultChecked={saved.inApp !== false}
          />
          In-app notifications
        </label>
        <label className="check">
          <input type="checkbox" name="push" defaultChecked={!!saved.push} />
          Push notifications
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="reminders"
            defaultChecked={saved.reminders !== false}
          />
          Match and score reminders
        </label>
        <Field label="Quiet hours start">
          <input
            name="quietStart"
            type="time"
            defaultValue={saved.quietStart ?? ""}
          />
        </Field>
        <Field label="Quiet hours end">
          <input
            name="quietEnd"
            type="time"
            defaultValue={saved.quietEnd ?? ""}
          />
        </Field>
      </Form>
    </Panel>
  );
}
export function Notifications() {
  const { user } = useSession(),
    action = useAction(),
    qc = useQueryClient();
  void action;
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data = [], error } = useList("notifications", [
    ["playerId", "==", user!.uid],
  ]);
  const sorted = [...data].sort(
    (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
  );
  const unread = sorted.filter((n) => !n.read);
  const shown = unreadOnly ? unread : sorted;
  // Match-related notices open the schedule; everything else opens the event.
  const matchTypes = [
    "match-reminder",
    "score-due",
    "match-changed",
    "reschedule-request",
    "reschedule-declined",
  ];
  const markRead = async (ids: string[]) => {
    await Promise.all(
      ids.map((id) =>
        updateDoc(doc(db, "notifications", id), {
          read: true,
          updatedAt: serverTimestamp(),
        }),
      ),
    );
    await qc.invalidateQueries();
  };
  return (
    <div className="page narrow">
      <p className="eyebrow">STAY IN THE LOOP</p>
      <h1>Your notifications</h1>
      <p className="lead" role="status">
        {unread.length ? `${unread.length} unread` : "No unread notifications"}
      </p>
      <div className="row">
        <div
          className="group-tabs"
          role="group"
          aria-label="Notification filter"
        >
          <button
            type="button"
            className="group-tab"
            aria-pressed={!unreadOnly}
            onClick={() => setUnreadOnly(false)}
          >
            All
          </button>
          <button
            type="button"
            className="group-tab"
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly(true)}
          >
            Unread <span className="filter-count">{unread.length}</span>
          </button>
        </div>
        {unread.length > 0 && (
          <Action onClick={() => markRead(unread.map((n) => n.id))}>
            Mark all as read
          </Action>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}
      {!shown.length ? (
        <Empty
          title={
            unreadOnly ? "No unread notifications" : "You’re all caught up"
          }
        />
      ) : (
        shown.map((n) => {
          const matchRelated = matchTypes.includes(String(n.type));
          const href =
            n.href ||
            (matchRelated
              ? "/schedule"
              : n.eventId
                ? `/events/${n.eventId}`
                : "/clubs/pprc");
          return (
            <Panel key={n.id} title={`${n.read ? "" : "New · "}${n.title}`}>
              <p>{n.body}</p>
              <div className="row">
                <Link to={href}>
                  {matchRelated
                    ? "Open my matches"
                    : n.href
                      ? "View update"
                      : "View event"}
                </Link>
                {!n.read && (
                  <Action onClick={() => markRead([n.id])}>Mark as read</Action>
                )}
              </div>
            </Panel>
          );
        })
      )}
      <NotificationPreferencesForm />
    </div>
  );
}

function OwnPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let current = "",
      active = true;
    getBlob(ref(storage, path))
      .then((blob) => {
        if (active) {
          current = URL.createObjectURL(blob);
          setUrl(current);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [path]);
  return url ? (
    <img className="profile-photo" src={url} alt="Your player profile" />
  ) : null;
}
