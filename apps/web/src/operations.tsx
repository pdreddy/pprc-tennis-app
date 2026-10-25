import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAction, useList, useSession } from "./context";
import { getOne } from "./firebase";
import {
  inCalendarView,
  localDateKey,
  operationsSummary,
  type CalendarView,
  type Entity,
} from "@pprc/shared";
import { Badge, Empty, Field, Form, Panel, date, text } from "./ui";
import { ConfirmDialog } from "./feedback";
import { useToast } from "./feedback";

// Club timezone used for player and organizer calendars.
export const clubTimezone = "America/Chicago";
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: clubTimezone });

export interface CalendarItem {
  id: string;
  title: string;
  start: string;
  location?: string;
}

// Day, week and month views over the same items. Dates are grouped by the
// club's local calendar day.
export function CalendarViews({ items }: { items: CalendarItem[] }) {
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(today());
  const visible = inCalendarView(items, view, anchor, clubTimezone);
  const groups = visible.reduce<Record<string, CalendarItem[]>>((acc, item) => {
    const key = localDateKey(item.start, clubTimezone);
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
  return (
    <section aria-label="Calendar" className="calendar-views">
      <div className="group-tabs" role="group" aria-label="Calendar view">
        {(["day", "week", "month"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className="group-tab"
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      <Field label="Show the period containing">
        <input
          type="date"
          value={anchor}
          onChange={(e) => e.target.value && setAnchor(e.target.value)}
        />
      </Field>
      {visible.length ? (
        Object.entries(groups).map(([day, list]) => (
          <div key={day} className="calendar-day">
            <h3>
              {new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </h3>
            <ul>
              {list.map((item) => (
                <li key={item.id}>
                  <strong>{date(item.start, clubTimezone, true)}</strong>{" "}
                  {item.title}
                  {item.location ? ` · ${item.location}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <Empty title="Nothing scheduled in this period" />
      )}
    </section>
  );
}

// Requests that involve the signed-in player. Only the opponent can accept or
// decline; the server rejects anyone else.
export function RescheduleRequests() {
  const { user } = useSession(),
    action = useAction(),
    toast = useToast();
  const [declining, setDeclining] = useState<string | null>(null);
  const respond = async (
    requestId: string,
    eventId: unknown,
    accept: boolean,
  ) => {
    try {
      const result = await action("respondReschedule", {
        eventId,
        requestId,
        accept,
      });
      toast(
        accept
          ? result?.status === "Awaiting organizer"
            ? "Accepted. The organizer will confirm the new time."
            : result?.status === "Stale"
              ? "The match changed before you answered, so nothing moved."
              : "Time change accepted."
          : "Request declined.",
        "success",
      );
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Could not respond.",
        "error",
      );
    }
  };
  const requests = useList("rescheduleRequests", [
    ["participantIds", "array-contains", user!.uid],
  ]);
  const pending = (requests.data ?? []).filter((r) => r.status === "Pending");
  return (
    <Panel title="Reschedule requests">
      {requests.error ? (
        <p className="error" role="alert">
          {requests.error.message}
        </p>
      ) : requests.isLoading ? (
        <p role="status">Loading requests…</p>
      ) : pending.length ? (
        <ul>
          {pending.map((r) => (
            <li key={r.id}>
              Proposed {date(String(r.proposedAt), clubTimezone, true)} on{" "}
              {String(r.courtId)} — {String(r.reason)}{" "}
              <Badge>{String(r.status)}</Badge>
              {r.opponentId === user!.uid ? (
                <span className="row">
                  <button
                    className="button primary"
                    onClick={() => respond(r.id, r.eventId, true)}
                  >
                    Accept
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setDeclining(r.id)}
                  >
                    Decline
                  </button>
                </span>
              ) : (
                <span className="muted"> Waiting for your opponent.</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No pending requests" />
      )}
      {declining && (
        <ConfirmDialog
          title="Decline this time change?"
          message="The player who asked will be told. You can ask again later."
          confirmLabel="Decline request"
          onCancel={() => setDeclining(null)}
          onConfirm={() => {
            const r = pending.find((x) => x.id === declining);
            setDeclining(null);
            if (r) respond(r.id, r.eventId, false);
          }}
        />
      )}
    </Panel>
  );
}

// Asks the opponent for a different time for one of your matches. The server
// checks availability, courts, blocks and conflicts before anything is stored.
export function RescheduleForm({ match }: { match: Entity }) {
  const action = useAction();
  const event = useQuery({
    queryKey: ["eventCourts", match.eventId],
    queryFn: () => getOne("events", String(match.eventId)),
  });
  const courts = (event.data?.courtIds as string[] | undefined) ?? [];
  return (
    <Form
      label="Request a new time"
      onSubmit={(f) =>
        action("requestReschedule", {
          eventId: match.eventId,
          matchId: match.id,
          courtId: text(f, "courtId"),
          scheduledAt: new Date(text(f, "when")).toISOString(),
          reason: text(f, "reason"),
        })
      }
    >
      <Field label="Court">
        <select
          name="courtId"
          defaultValue={String(match.courtId ?? courts[0] ?? "")}
        >
          {courts.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Proposed time (your local time)">
        <input name="when" type="datetime-local" required />
      </Field>
      <Field label="Reason">
        <input name="reason" required minLength={5} />
      </Field>
    </Form>
  );
}

// Organizer view of one event: counts, reschedule requests and the calendar.
export function OperationsDashboard() {
  const action = useAction();
  const events = useList("events", [["clubId", "==", "pprc"]]);
  const [eventId, setEventId] = useState("");
  const selected = events.data?.find((e) => e.id === eventId);
  const matches = useList("matches", [["eventId", "==", eventId]], !!eventId);
  const requests = useList(
    "rescheduleRequests",
    [["eventId", "==", eventId]],
    !!eventId,
  );
  const summary =
    selected && matches.data
      ? operationsSummary(matches.data, Date.now(), {
          durationMinutes: Number(selected.duration ?? 75),
          bufferMinutes: Number(selected.buffer ?? 15),
        })
      : null;
  const pendingRequests = (requests.data ?? []).filter(
    (r) => r.status === "Pending",
  ).length;
  const encounters = useList(
    "teamEncounters",
    [["eventId", "==", eventId]],
    !!eventId,
  );
  const teams = useList("teams", [["eventId", "==", eventId]], !!eventId);
  const teamName = (id: unknown) =>
    String(teams.data?.find((t) => t.id === id)?.name ?? "Team");
  // Tournament matches and team encounters, on one organizer calendar.
  const calendar: CalendarItem[] = [
    ...(matches.data ?? [])
      .filter((m) => m.scheduledAt)
      .map((m) => ({
        id: m.id,
        title: `Round ${m.round}`,
        start: String(m.scheduledAt),
        location: m.courtId ? String(m.courtId) : undefined,
      })),
    ...(encounters.data ?? [])
      .filter((e) => e.scheduledAt)
      .map((e) => ({
        id: `team-${e.id}`,
        title: `Team: ${teamName(e.teamA)} vs ${teamName(e.teamB)}`,
        start: String(e.scheduledAt),
        location: e.courtId ? String(e.courtId) : undefined,
      })),
  ];
  return (
    <div className="page">
      <p className="eyebrow">ORGANIZER OPERATIONS</p>
      <h1>Operations</h1>
      <Field label="Event">
        <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">Choose an event</option>
          {(events.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {String(e.name)}
            </option>
          ))}
        </select>
      </Field>
      {events.error && (
        <p className="error" role="alert">
          {events.error.message}
        </p>
      )}
      {!eventId ? (
        <Empty title="Choose an event to see its operations" />
      ) : matches.error ? (
        <p className="error" role="alert">
          {matches.error.message}
        </p>
      ) : !summary ? (
        <p role="status">Loading operations…</p>
      ) : (
        <>
          <section className="stat-grid" aria-label="Operations summary">
            {[
              ["Upcoming in 7 days", summary.upcoming],
              ["Unscheduled", summary.unscheduled],
              ["Overdue", summary.overdue],
              ["Missing scores", summary.missingScores],
              ["Court or player overlaps", summary.courtConflicts],
              ["Pending reschedule requests", pendingRequests],
              [
                "Completion",
                summary.completionPercent === null
                  ? "No matches yet"
                  : `${summary.completionPercent}%`,
              ],
            ].map(([label, value]) => (
              <div className="stat-card" key={String(label)}>
                <span className="muted">{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </section>
          <Panel title="Reminder timing">
            <Form
              label="Save reminder timing"
              onSubmit={(f) =>
                action("setReminderPolicy", {
                  eventId,
                  upcomingMinutes: Number(text(f, "upcomingMinutes")),
                  overdueHours: Number(text(f, "overdueHours")),
                  reason: text(f, "reason"),
                })
              }
            >
              <Field label="Upcoming match reminder (minutes before start)">
                <input
                  name="upcomingMinutes"
                  type="number"
                  min={5}
                  max={240}
                  defaultValue={selected?.reminderUpcomingMinutes ?? 30}
                />
              </Field>
              <Field label="Score-due reminder (hours after start)">
                <input
                  name="overdueHours"
                  type="number"
                  min={1}
                  max={48}
                  defaultValue={selected?.reminderOverdueHours ?? 2}
                />
              </Field>
              <Field label="Audit reason">
                <input name="reason" required minLength={5} />
              </Field>
            </Form>
          </Panel>
          <Panel title="Reschedule approval">
            <Form
              label="Save approval setting"
              onSubmit={(f) =>
                action("setReschedulePolicy", {
                  eventId,
                  enabled: f.get("enabled") === "on",
                  reason: text(f, "reason"),
                })
              }
            >
              <label className="check">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={!!selected?.rescheduleApproval}
                />
                Organizer must approve reschedules after the opponent accepts
              </label>
              <Field label="Audit reason">
                <input name="reason" required minLength={5} />
              </Field>
            </Form>
            {(requests.data ?? [])
              .filter((r) => r.status === "Awaiting organizer")
              .map((r) => (
                <div key={r.id} className="row">
                  <span>
                    Proposed {date(String(r.proposedAt), clubTimezone, true)} on{" "}
                    {String(r.courtId)}
                  </span>
                  <Form
                    label="Approve"
                    onSubmit={(f) =>
                      action("decideReschedule", {
                        eventId,
                        requestId: r.id,
                        approve: true,
                        reason: text(f, "reason"),
                      })
                    }
                  >
                    <Field label="Audit reason">
                      <input name="reason" required minLength={5} />
                    </Field>
                  </Form>
                  <Form
                    label="Decline"
                    onSubmit={(f) =>
                      action("decideReschedule", {
                        eventId,
                        requestId: r.id,
                        approve: false,
                        reason: text(f, "reason"),
                      })
                    }
                  >
                    <Field label="Audit reason">
                      <input name="reason" required minLength={5} />
                    </Field>
                  </Form>
                </div>
              ))}
          </Panel>
          <Panel title="Event calendar">
            <CalendarViews items={calendar} />
          </Panel>
        </>
      )}
    </div>
  );
}
