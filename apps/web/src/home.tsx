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
import { useList, useSession, usePlayerMatches } from "./context";
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
  "Final",
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
    matches = usePlayerMatches(),
    notes = useList("notifications", [["playerId", "==", uid]]),
    events = useList("events", [
      ["visibility", "==", "public"],
      ["status", "!=", "Draft"],
    ]);

  const eventName = (eventId?: string) =>
    events.data?.find((e) => e.id === eventId)?.name ?? "Event details";

  const now = Date.now();
  const upcoming = (matches.data ?? [])
    .filter((m) => m.status === "Scheduled")
    .sort((a, b) =>
      String(a.scheduledAt ?? "").localeCompare(String(b.scheduledAt ?? "")),
    );
  const upcomingDated = upcoming.filter(
    (m) => m.scheduledAt && Date.parse(m.scheduledAt) >= now,
  );
  const activeChallenges = (challenges.data ?? []).filter(
    (c) => !c.completedAt && !terminalChallenge.includes(String(c.state)),
  );
  const unread = (notes.data ?? []).filter((n) => !n.read).length;
  const name = profile?.displayName ?? "player";
  const activeRegs = regs.data?.filter(
    (r) =>
      !["Withdrawn", "Rejected", "Refunded", "Cancelled"].includes(r.state),
  );
  const needsPayment = regs.data?.some((r) => r.state === "Pending Payment");
  const incoming = activeChallenges.find(
    (c) =>
      c.state === "Pending" &&
      teams.data?.some((t) => t.id === c.defenderId && t.captainId === uid),
  );
  const focus = incoming
    ? {
        title: "A challenger is waiting for you.",
        description: "Review the challenge and respond before its deadline.",
        href: `/events/${incoming.eventId}`,
        action: "Review challenge",
      }
    : needsPayment
      ? {
          title: "Your place is waiting to be confirmed.",
          description:
            "Review your registration and complete the payment step.",
          href: "/my-events",
          action: "Open my registrations",
        }
      : upcomingDated.length
        ? {
            title: "Your next match starts here.",
            description:
              "Check your court, review the schedule and prepare to play.",
            href: "/schedule",
            action: "Open match center",
          }
        : {
            title: "Make room for your next great match.",
            description:
              "Explore tournaments, find your format and get back on court.",
            href: "/events",
            action: "Find your next tournament",
          };

  return (
    <div className="page player-workspace">
      <header className="workspace-welcome">
        <div>
          <p className="eyebrow">WELCOME BACK</p>
          <h1>Hi, {name}</h1>
          <p className="lead">
            Your ratings, schedule and competition at a glance.
          </p>
        </div>
        <div className="workspace-mark">
          <strong>YOUR CLUB. YOUR COMPETITION.</strong>
          <span>
            {new Intl.DateTimeFormat("en-US", {
              timeZone: "America/Chicago",
              weekday: "long",
              month: "short",
              day: "numeric",
            }).format(new Date())}
          </span>
        </div>
      </header>
      <section className="stat-grid" aria-label="Ratings">
        <Rating label="Singles" value={profile?.singlesUtr} />
        <Rating label="Doubles" value={profile?.doublesUtr} />
      </section>
      <p className="muted">
        Ratings are supplied references (
        {profile?.ratingSource ?? "Player provided"}), not official UTR ratings.
      </p>

      <div className="workspace-metrics" aria-label="Your activity">
        <Link to="/my-events">
          <strong>
            {regs.error
              ? "Unavailable"
              : regs.data
                ? activeRegs!.length
                : "Loading"}
          </strong>
          <span>Active registrations</span>
        </Link>
        <Link to="/schedule">
          <strong>
            {matches.error
              ? "Unavailable"
              : matches.data
                ? upcomingDated.length
                : "Loading"}
          </strong>
          <span>Upcoming singles</span>
        </Link>
        <Link to="/teams">
          <strong>
            {teams.error
              ? "Unavailable"
              : teams.data
                ? teams.data.filter((t) => !t.withdrawn).length
                : "Loading"}
          </strong>
          <span>Teams & entries</span>
        </Link>
        <Link to="/notifications" data-testid="workspace-unread">
          <strong>
            {notes.error ? "Unavailable" : notes.data ? unread : "Loading"}
          </strong>
          <span>Unread updates</span>
        </Link>
      </div>
      <section className="workspace-focus" data-testid="workspace-focus">
        <div>
          <p className="eyebrow">YOUR NEXT MOVE</p>
          <h2>{focus.title}</h2>
          <p>{focus.description}</p>
        </div>
        <div>
          <Link className="button primary" to={focus.href}>
            {focus.action}
            <ArrowUpRight size={18} />
          </Link>
        </div>
      </section>
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

      <div className="workspace-grid">
        <Panel
          title="Upcoming matches"
          action={<Link to="/schedule">All matches</Link>}
        >
          {matches.error ? (
            <Unavailable error={matches.error as Error} />
          ) : matches.isLoading ? (
            <p role="status">Loading matches…</p>
          ) : upcomingDated.length ? (
            <ul>
              {upcomingDated.slice(0, 5).map((m) => (
                <li key={m.id}>
                  <CalendarDays size={15} aria-hidden="true" />{" "}
                  <Link to={`/events/${m.eventId}`}>
                    {date(
                      m.scheduledAt,
                      events.data?.find((e) => e.id === m.eventId)?.timezone ??
                        m.timezone ??
                        "America/Chicago",
                      true,
                    )}{" "}
                    · Round {m.round}
                  </Link>
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
                  <Link to={`/events/${r.eventId}`}>
                    {eventName(r.eventId)}
                  </Link>{" "}
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
                  <Medal size={15} aria-hidden="true" />{" "}
                  <Link to={`/events/${c.eventId}`}>
                    {eventName(c.eventId)}
                  </Link>{" "}
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
                  <Link to={`/events/${t.eventId}/triace`}>
                    {String(t.name ?? "Team")}
                  </Link>
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
    </div>
  );
}
