import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Users, MapPin, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { useSession, useAction, useList } from "./context";
import { getOne } from "./firebase";
import {
  Action,
  Badge,
  Empty,
  EventCard,
  Field,
  Form,
  Panel,
  text,
  reference,
} from "./ui";
import type { Entity } from "@pprc/shared";

export function OnboardingSteps() {
  const { profile, member } = useSession();
  const steps = [
    { name: "Player profile", to: "/profile", complete: !!profile },
    {
      name: "Club membership",
      to: "/clubs/pprc",
      complete: member?.clubId === "pprc" && member?.member === true,
    },
    { name: "Find your competition", to: "/events", complete: false },
  ];
  return (
    <Panel title="Your next steps">
      <ol className="onboarding-steps">
        {steps.map((step, i) => (
          <li key={step.to}>
            <span className={step.complete ? "step-complete" : ""}>
              {step.complete ? <CheckCircle2 size={18} /> : i + 1}
            </span>
            <Link to={step.to}>{step.name}</Link>
            <small>{step.complete ? "Complete" : "Explore"}</small>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
export function ClubPage() {
  const { clubId = "pprc" } = useParams(),
    { user, profile, member } = useSession(),
    action = useAction();
  const club = useQuery({
    queryKey: ["club", clubId],
    queryFn: () => getOne("clubs", clubId),
    enabled: clubId === "pprc",
  });
  const request = useQuery({
    queryKey: ["membershipRequest", user?.uid],
    queryFn: () => getOne("membershipRequests", user!.uid),
    enabled: !!user && clubId === "pprc",
  });
  const isMember = member?.clubId === "pprc" && member?.member === true;
  const publicEvents = useList(
    "events",
    [
      ["clubId", "==", "pprc"],
      ["visibility", "==", "public"],
      ["status", "!=", "Draft"],
    ],
    clubId === "pprc",
  );
  const memberEvents = useList(
    "events",
    [
      ["clubId", "==", "pprc"],
      ["visibility", "==", "private"],
      ["status", "!=", "Draft"],
    ],
    clubId === "pprc" && isMember,
  );
  if (clubId !== "pprc")
    return (
      <Empty title="Club not found">
        <Link to="/clubs/pprc">Visit PPRC</Link>
      </Empty>
    );
  if (club.isLoading)
    return (
      <p className="page" role="status">
        Loading club…
      </p>
    );
  if (club.error)
    return (
      <p className="page error" role="alert">
        {club.error.message}
      </p>
    );
  if (!club.data) return <Empty title="Club is not configured yet" />;
  const current = club.data,
    pending = request.data?.status === "Pending",
    events = [
      ...new Map(
        [...(publicEvents.data ?? []), ...(memberEvents.data ?? [])].map(
          (e) => [e.id, e],
        ),
      ).values(),
    ];
  return (
    <div className="page">
      <section className="club-hero">
        <div className="club-monogram" aria-hidden="true">
          P<span>∕</span>
        </div>
        <div>
          <p className="eyebrow">YOUR HOME COURT</p>
          <h1>{current.name}</h1>
          <p>
            <MapPin size={16} />
            {current.location || "Prosper, Texas"} · {current.timezone}
          </p>
        </div>
      </section>
      <div className="two-columns">
        <Panel title="Your club membership">
          {request.error && (
            <p className="error" role="alert">
              {request.error.message}
            </p>
          )}
          {!user ? (
            <>
              <p>
                Join the club community to discover member events and play with
                your team.
              </p>
              <Link className="button primary" to="/signin">
                Sign in or create an account
              </Link>
            </>
          ) : isMember ? (
            <>
              <Badge>Club member</Badge>
              <p>
                You can access member events and club competition. Your
                directory listing follows your profile visibility.
              </p>
              <Link className="text-link" to="/profile">
                Manage profile visibility →
              </Link>
            </>
          ) : !profile ? (
            <>
              <p>Complete your player profile before requesting membership.</p>
              <Link className="button primary" to="/profile">
                Complete player profile
              </Link>
            </>
          ) : pending ? (
            <>
              <Badge>Pending review</Badge>
              <p>
                Your request is with the club team. You’ll receive a
                notification when it’s reviewed.
              </p>
              <Action
                onClick={() =>
                  action("withdrawClubMembershipRequest", { clubId: "pprc" })
                }
              >
                Withdraw membership request
              </Action>
            </>
          ) : (
            <>
              {request.data && (
                <p className="notice">
                  {request.data.status === "Approved"
                    ? "Your membership is currently inactive."
                    : `Previous request: ${request.data.status}.`}{" "}
                  {request.data.decisionReason ?? ""}
                </p>
              )}
              {current.acceptingMembershipRequests === false ? (
                <p>
                  Membership requests are currently closed. Contact the club
                  team for help.
                </p>
              ) : (
                <Form
                  label="Request club membership"
                  onSubmit={(f) =>
                    action("requestClubMembership", {
                      clubId: "pprc",
                      message: text(f, "message"),
                    })
                  }
                >
                  <p>
                    The club team reviews applications. Requesting membership
                    does not grant organizer or admin access.
                  </p>
                  <Field label="Message to the club (optional)">
                    <textarea name="message" maxLength={500} />
                  </Field>
                </Form>
              )}
            </>
          )}
        </Panel>
        <Panel title="Competition, with community">
          <p>
            Find your next event, build a team, and follow every result in one
            place.
          </p>
          <div className="button-row">
            <Link className="button secondary" to="/events">
              Explore events <ArrowUpRight size={16} />
            </Link>
            <Link className="button secondary" to="/teams">
              My teams <Users size={16} />
            </Link>
          </div>
          {current.contactEmail && (
            <p>
              <a className="text-link" href={`mailto:${current.contactEmail}`}>
                Contact the club
              </a>
            </p>
          )}
          <small>
            Private contact information, membership applications and role
            assignments are never part of the public directory.
          </small>
        </Panel>
      </div>
      <h2>Club events</h2>
      {(publicEvents.error || memberEvents.error) && (
        <p className="error" role="alert">
          {(publicEvents.error ?? memberEvents.error)?.message}
        </p>
      )}
      <div className="event-grid">
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
      {!events.length && (
        <p className="muted">Published club events will appear here.</p>
      )}
      <PlayerDirectory clubOnly />
    </div>
  );
}
export function PlayerDirectory({ clubOnly = false }: { clubOnly?: boolean }) {
  const [search, setSearch] = useState(""),
    [city, setCity] = useState("");
  const players = useList(
    "publicProfiles",
    clubOnly ? [["memberClubId", "==", "pprc"]] : [["clubId", "==", "pprc"]],
  );
  const rows = (players.data ?? []).filter(
    (p) =>
      (!city || p.city === city) &&
      `${p.displayName} ${p.city} ${p.tennisLevel}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="player-directory">
      <div className="section-heading">
        <div>
          <p className="eyebrow">GOOD PEOPLE. GREAT COMPETITION.</p>
          <h2>
            {clubOnly
              ? "Public member directory"
              : "Find your next hitting partner"}
          </h2>
          <p className="muted">
            Only players who choose a public profile are listed.
          </p>
        </div>
      </div>
      <div className="directory-filters">
        <Field label={clubOnly ? "Search club members" : "Search players"}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, city or playing level"
          />
        </Field>
        <Field label="Player city">
          <select value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">All cities</option>
            {[...new Set(players.data?.map((p) => p.city).filter(Boolean))]
              .sort()
              .map((c) => (
                <option key={c}>{c}</option>
              ))}
          </select>
        </Field>
      </div>
      {players.error && (
        <p role="alert" className="error">
          {players.error.message}
        </p>
      )}
      <div className="player-grid">
        {rows.map((player) => (
          <PlayerCard key={player.id} player={player} />
        ))}
      </div>
      {!rows.length && <Empty title="No public players match your search" />}
    </section>
  );
}
function PlayerCard({ player: p }: { player: Entity }) {
  return (
    <article className="panel player-card">
      <div className="player-avatar" aria-hidden="true">
        {p.displayName
          ?.split(" ")
          .map((s: string) => s[0])
          .slice(0, 2)
          .join("")}
      </div>
      <div>
        <h3>
          <Link to={`/players/${p.id}`}>{p.displayName}</Link>
        </h3>
        <p className="muted">
          {p.city || "City not shared"} · {p.tennisLevel || "Level not shared"}
        </p>
        {p.memberClubId === "pprc" && <Badge>Club member</Badge>}
      </div>
      <div className="player-reference">
        <small>External reference</small>
        <strong>{reference(p.externalRating)}</strong>
      </div>
      <Link
        className="text-link"
        to={`/players/${p.id}`}
        aria-label={`View ${p.displayName}`}
      >
        View player <ArrowUpRight size={16} />
      </Link>
    </article>
  );
}
export function PlayersPage() {
  return (
    <div className="page">
      <p className="eyebrow">PPRC PEOPLE</p>
      <h1>Players</h1>
      <div className="button-row">
        <Link className="button secondary" to="/rankings">
          Reference leaderboard
        </Link>
        <Link className="button secondary" to="/dashboard">
          My performance
        </Link>
      </div>
      <PlayerDirectory />
    </div>
  );
}
export function PublicPlayer() {
  const { playerId = "" } = useParams();
  const profile = useQuery({
    queryKey: ["publicPlayer", playerId],
    queryFn: () => getOne("publicProfiles", playerId),
    enabled: !!playerId,
  });
  if (profile.isLoading)
    return (
      <p className="page" role="status">
        Loading player…
      </p>
    );
  if (profile.error)
    return (
      <p className="page error" role="alert">
        {profile.error.message}
      </p>
    );
  if (!profile.data)
    return (
      <div className="page">
        <Empty title="This player isn’t publicly listed">
          <Link to="/players">Find public players</Link>
        </Empty>
      </div>
    );
  const p = profile.data;
  return (
    <div className="page narrow">
      <Link className="text-link" to="/players">
        ← Players
      </Link>
      <Panel>
        <div className="player-profile-heading">
          <div className="player-avatar large" aria-hidden="true">
            {p.displayName
              ?.split(" ")
              .map((s: string) => s[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div>
            <p className="eyebrow">PUBLIC PLAYER PROFILE</p>
            <h1>{p.displayName}</h1>
            <p>{p.city || "City not shared"}</p>
            {p.memberClubId === "pprc" && <Badge>Club member</Badge>}
          </div>
        </div>
        <p className="lead">{p.tennisLevel || "Playing level not shared"}</p>
        <div className="reference-grid">
          {[
            ["Singles reference", p.singlesUtr ?? p.externalRating],
            ["Doubles reference", p.doublesUtr ?? p.externalRating],
          ].map(([label, value]) => (
            <div key={label as string}>
              <small>{label}</small>
              <strong>{reference(value)}</strong>
            </div>
          ))}
        </div>
        <p className="muted">
          {p.ratingSource || "Player provided"}. External values are references;
          PPRC does not calculate proprietary ratings.
        </p>
      </Panel>
      <Link className="button secondary" to="/clubs/pprc">
        Visit the club
      </Link>
    </div>
  );
}
export function ClubMembershipRequests() {
  const { member } = useSession(),
    action = useAction(),
    allowed = ["clubAdmin", "platformAdmin"].includes(member?.role);
  const requests = useList(
    "membershipRequests",
    [
      ["clubId", "==", "pprc"],
      ["status", "==", "Pending"],
    ],
    allowed,
  );
  if (!allowed) return null;
  return (
    <Panel title="Membership applications">
      {requests.error && (
        <p className="error" role="alert">
          {requests.error.message}
        </p>
      )}
      {!requests.data?.length && <p>No applications awaiting review.</p>}
      {requests.data?.map((request) => (
        <article
          className="membership-application"
          key={request.id}
          data-testid={`membership-${request.playerId}`}
        >
          <h3>{request.displayName}</h3>
          <p className="muted">
            {request.city} · Attempt {request.attempt}
          </p>
          <p>{request.message || "No message supplied."}</p>
          {member?.role === "clubAdmin" ? (
            <Form
              label="Review membership"
              onSubmit={(f) =>
                action("reviewClubMembership", {
                  clubId: "pprc",
                  playerId: request.playerId,
                  decision: text(f, "decision"),
                  reason: text(f, "reason"),
                })
              }
            >
              <Field label="Membership decision">
                <select name="decision">
                  <option>Approved</option>
                  <option>Rejected</option>
                </select>
              </Field>
              <Field label="Decision reason (shared with player)">
                <input name="reason" minLength={5} maxLength={1000} required />
              </Field>
            </Form>
          ) : (
            <p>Read-only review access.</p>
          )}
        </article>
      ))}
    </Panel>
  );
}
