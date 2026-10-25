import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Bell,
  CalendarDays,
  Medal,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import { useList, useSession } from "./context";
import { Badge, Empty, Panel, date } from "./ui";

// Signed-in home. Every value comes from an authorized Firestore query. A
// failed query shows an error; an empty result shows an explicit empty state.
// Missing ratings show "Not provided", never zero.

const terminalChallenge = [
  "Declined",
  "Expired",
  "Cancelled",
  "Superseded",
  "Completed",
];

function Rating({ label, value }: { label: string; value: unknown }) {
  const provided = typeof value === "number" && Number.isFinite(value);
  return (
    <div className="stat-card">
      <span className="muted">{label}</span>
      <strong>
        {provided ? (value as number).toFixed(2) : "Not provided"}
      </strong>
    </div>
  );
}

function Unavailable({ error }: { error: Error }) {
  return (
    <p className="error" role="alert">
      Could not load this section. {error.message}
    </p>
  );
}

export function PlayerHome() {
  const { user, profile } = useSession(),
    uid = user!.uid;
  const regs = useList("registrations", [["playerId", "==", uid]]),
    teams = useList("teams", [["memberIds", "array-contains", uid]]),
    challenges = useList("ladderChallenges", [
      ["participantIds", "array-contains", uid],
    ]),
    matchesAsOne = useList("matches", [
      ["p1", "==", uid],
      ["published", "==", true],
    ]),
    matchesAsTwo = useList("matches", [
      ["p2", "==", uid],
      ["published", "==", true],
    ]),
    notes = useList("notifications", [["playerId", "==", uid]]),
    events = useList("events", [
      ["visibility", "==", "public"],
      ["status", "!=", "Draft"],
    ]);

  const eventName = (eventId?: string) =>
    events.data?.find((e) => e.id === eventId)?.name ?? "Event details";

  const now = Date.now();
  const upcoming = [...(matchesAsOne.data ?? []), ...(matchesAsTwo.data ?? [])]
    .filter((m) => m.status === "Scheduled")
    .sort((a, b) =>
      String(a.scheduledAt ?? "").localeCompare(String(b.scheduledAt ?? "")),
    );
  const upcomingDated = upcoming.filter(
    (m) => m.scheduledAt && Date.parse(m.scheduledAt) >= now,
  );
  const activeChallenges = (challenges.data ?? []).filter(
    (c) => !terminalChallenge.includes(String(c.state)),
  );
  const unread = (notes.data ?? []).filter((n) => !n.read).length;
  const name = profile?.displayName ?? "player";

  return (
    <div className="page">
      <p className="eyebrow">WELCOME BACK</p>
      <h1>Hi, {name}</h1>
      <p className="lead">
        Your ratings, schedule and competition at a glance.
      </p>

      <section className="stat-grid" aria-label="Ratings">
        <Rating label="Singles" value={profile?.singlesUtr} />
        <Rating label="Doubles" value={profile?.doublesUtr} />
      </section>
      <p className="muted">
        Ratings are supplied references (
        {profile?.ratingSource ?? "Player provided"}), not official UTR ratings.
      </p>

      <div className="quick-links" aria-label="Relevant actions">
        <Link to="/events">
          Find a tournament <ArrowUpRight size={15} />
        </Link>
        <Link to="/schedule">Submit a score</Link>
        <Link to="/rankings">View rankings</Link>
        <Link to="/notifications">
          <Bell size={15} aria-hidden="true" /> Notifications
          {notes.data ? ` (${unread} unread)` : ""}
        </Link>
      </div>

      <Panel
        title="Upcoming matches"
        action={<Link to="/schedule">All matches</Link>}
      >
        {matchesAsOne.error || matchesAsTwo.error ? (
          <Unavailable
            error={(matchesAsOne.error ?? matchesAsTwo.error) as Error}
          />
        ) : matchesAsOne.isLoading || matchesAsTwo.isLoading ? (
          <p role="status">Loading matches…</p>
        ) : upcomingDated.length ? (
          <ul>
            {upcomingDated.slice(0, 5).map((m) => (
              <li key={m.id}>
                <CalendarDays size={15} aria-hidden="true" />{" "}
                {date(m.scheduledAt, "America/Chicago", true)} · Round {m.round}
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No upcoming matches">
            <Link to="/events">Browse tournaments to get on court.</Link>
          </Empty>
        )}
      </Panel>

      <Panel
        title="My registrations"
        action={<Link to="/my-events">All events</Link>}
      >
        {regs.error ? (
          <Unavailable error={regs.error as Error} />
        ) : regs.isLoading ? (
          <p role="status">Loading registrations…</p>
        ) : regs.data?.length ? (
          <ul>
            {regs.data.slice(0, 5).map((r) => (
              <li key={r.id}>
                <Trophy size={15} aria-hidden="true" />{" "}
                <Link to={`/events/${r.eventId}`}>{eventName(r.eventId)}</Link>{" "}
                <Badge>{String(r.state)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No registrations yet">
            <Link to="/events">Find an event and register.</Link>
          </Empty>
        )}
      </Panel>

      <Panel title="Active ladder challenges">
        {challenges.error ? (
          <Unavailable error={challenges.error as Error} />
        ) : challenges.isLoading ? (
          <p role="status">Loading challenges…</p>
        ) : activeChallenges.length ? (
          <ul>
            {activeChallenges.map((c) => (
              <li key={c.id}>
                <Medal size={15} aria-hidden="true" /> {eventName(c.eventId)}{" "}
                <Badge>{String(c.state)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No active challenges" />
        )}
      </Panel>

      <Panel title="My teams" action={<Link to="/teams">Manage teams</Link>}>
        {teams.error ? (
          <Unavailable error={teams.error as Error} />
        ) : teams.isLoading ? (
          <p role="status">Loading teams…</p>
        ) : teams.data?.length ? (
          <ul>
            {teams.data.map((t) => (
              <li key={t.id}>
                <Users size={15} aria-hidden="true" />{" "}
                {String(t.name ?? "Team")}
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="You are not on a team">
            <UserRound size={16} aria-hidden="true" />{" "}
            <Link to="/teams">Create a team or accept an invitation.</Link>
          </Empty>
        )}
      </Panel>
    </div>
  );
}
