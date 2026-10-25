import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowUpRight, Trophy } from "lucide-react";
import { useList, useSession } from "./context";
import { call } from "./firebase";
import {
  referenceLeaderboard,
  type Entity,
  type PerformanceRecord,
} from "@pprc/shared";
import { Badge, Empty, Field, Panel, date, reference } from "./ui";

export function PerformanceDashboard() {
  const { user, profile } = useSession(),
    [showAll, setShowAll] = useState(false);
  const result = useQuery({
    queryKey: ["myPerformance", user?.uid],
    queryFn: () => call("getMyPerformance"),
    enabled: !!user && !!profile,
    staleTime: 60000,
    refetchInterval: 60000,
  });
  const profiles = useList("publicProfiles", [["clubId", "==", "pprc"]]);
  if (!profile)
    return (
      <div className="page">
        <Empty title="Complete your player profile">
          <Link className="button primary" to="/profile">
            Set up my profile
          </Link>
        </Empty>
      </div>
    );
  if (result.isLoading)
    return (
      <p className="page" role="status">
        Loading your recorded results…
      </p>
    );
  if (result.error)
    return (
      <p className="page error" role="alert">
        {result.error.message}
      </p>
    );
  if (!result.data) return null;
  const data = result.data,
    summary = data.summary,
    name = (id: string) =>
      profiles.data?.find((p) => p.id === id)?.displayName ?? "Private player";
  const kind = (value: string) =>
    value === "tiebreak"
      ? "Super tiebreak"
      : value === "doubles"
        ? "Doubles"
        : "Singles";
  const maximum = Math.max(1, ...summary.activity.map((row: any) => row.total));
  return (
    <div className="page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR GAME, RECORDED</p>
          <h1>My performance</h1>
          <p className="lead">
            Confirmed PPRC results. A clear view of your competition.
          </p>
        </div>
        <Link className="button secondary" to="/profile">
          My profile <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="stat-grid">
        {[
          [summary.total, "Confirmed results"],
          [summary.wins, "Wins"],
          [
            summary.winPercentage === null ? "—" : `${summary.winPercentage}%`,
            "Win rate",
          ],
          [summary.played, "Played contests"],
        ].map(([value, label]) => (
          <div
            className="stat-card"
            key={label as string}
            data-testid={`performance-${String(label).replaceAll(" ", "-").toLowerCase()}`}
          >
            <Activity size={18} />
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="muted">
        Wins include confirmed exceptional outcomes; played contests exclude
        unplayed walkovers, defaults and forfeits. Team figures count only
        rubbers you were assigned to play.
      </p>
      {!summary.total && (
        <Empty title="Your performance story starts on court">
          Confirmed results will appear here after you play.{" "}
          <Link className="text-link" to="/events">
            Find an event →
          </Link>
        </Empty>
      )}
      <div className="two-columns">
        <Panel title="Results by format">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Format</th>
                  <th>Results</th>
                  <th>Won</th>
                  <th>Lost</th>
                </tr>
              </thead>
              <tbody>
                {summary.breakdown.map((row: any) => (
                  <tr key={row.kind}>
                    <td>{kind(row.kind)}</td>
                    <td>{row.total}</td>
                    <td>{row.wins}</td>
                    <td>{row.losses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Recorded activity">
          {!summary.activity.length && (
            <p className="muted">Activity appears when a result is recorded.</p>
          )}
          <div
            className="activity-chart"
            role="img"
            aria-label="Confirmed results recorded by month"
          >
            {summary.activity.slice(-12).map((row: any) => (
              <div className="activity-chart-row" key={row.month}>
                <span>{row.month}</span>
                <div>
                  <i style={{ width: `${(row.total / maximum) * 100}%` }} />
                </div>
                <strong>{row.total}</strong>
              </div>
            ))}
          </div>
          <small>
            Grouped by record creation month, which may differ from when a match
            was played.
          </small>
        </Panel>
      </div>
      <Panel title="My confirmed match history">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Result</th>
                <th>Contest</th>
                <th>Opponent</th>
                <th>Recorded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data.history as PerformanceRecord[])
                .slice(0, showAll ? data.history.length : 20)
                .map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Badge>{row.won ? "Won" : "Lost"}</Badge>
                    </td>
                    <td>
                      {kind(row.kind)}
                      <small>
                        {row.source === "team-rubber"
                          ? "Team rubber"
                          : "Individual result"}{" "}
                        · {row.outcome}
                        {row.version > 1 ? ` · Corrected v${row.version}` : ""}
                      </small>
                    </td>
                    <td>{row.opponentIds.map(name).join(" / ")}</td>
                    <td>
                      {row.recordedAt
                        ? date(row.recordedAt)
                        : "Date unavailable"}
                    </td>
                    <td>
                      <Link className="text-link" to={`/events/${row.eventId}`}>
                        View event
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {data.history.length > 20 && (
          <button
            className="button secondary"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll
              ? "Show recent 20"
              : `Show all ${data.history.length} records`}
          </button>
        )}
        {data.coverage.truncated && (
          <p className="notice">
            This view covers the latest {data.coverage.limit} retrieved records.
            Additional older history exists.
          </p>
        )}
      </Panel>
      <Panel title="My external reference values">
        <div className="reference-grid">
          {[
            ["Singles reference", data.references.singles],
            ["Doubles reference", data.references.doubles],
          ].map(([label, value]) => (
            <div key={label as string}>
              <small>{label}</small>
              <strong>{reference(value)}</strong>
            </div>
          ))}
        </div>
        <p className="muted">
          {data.references.source}. These are supplied reference values,
          separate from your PPRC win/loss statistics.
        </p>
        <Link className="text-link" to="/profile">
          Update my references →
        </Link>
      </Panel>
      <Panel title="Registration reference history">
        <p className="muted">
          Snapshots capture the values used for a team registration. They are
          not a live rating feed or a calculated UTR history.
        </p>
        {!data.referenceHistory.length && (
          <p>No registration reference snapshots yet.</p>
        )}
        {data.referenceHistory.map((snapshot: any) => (
          <div className="division-row" key={snapshot.id}>
            <div>
              <strong>
                {reference(snapshot.reference)} team-eligibility reference
              </strong>
              <p>
                Singles {reference(snapshot.singles)} · Doubles{" "}
                {reference(snapshot.doubles)}
              </p>
              <small>
                {snapshot.capturedAt
                  ? date(snapshot.capturedAt)
                  : "Date unavailable"}{" "}
                · {snapshot.source}
              </small>
            </div>
            <Link className="text-link" to={`/events/${snapshot.eventId}`}>
              Registration event →
            </Link>
          </div>
        ))}
      </Panel>
    </div>
  );
}
// Ladder standings are computed by the server ranking engine and stored on the
// event. The client only displays them; it never recalculates positions.
function LadderSeasonTable({ event }: { event: Entity }) {
  const teams = useList("teams", [["eventId", "==", event.id]]);
  const standings = (event.ladderState?.standings ?? []) as {
    teamId: string;
    position: number;
    points: number;
    played: number;
    wins: number;
    losses: number;
  }[];
  const name = (id: string) =>
    teams.data?.find((t) => t.id === id)?.name ?? "Entrant";
  return (
    <Panel title={String(event.name)}>
      {teams.error && (
        <p className="muted" role="status">
          Entrant names are unavailable; positions are still the server
          standings.
        </p>
      )}
      <p className="muted">
        Positions follow the published season rules. Points-leader ties are
        broken by match wins, then successful upward challenges, then
        head-to-head, then a recorded organizer decision. Movement since the
        previous week is not shown yet.
      </p>
      <div className="table-scroll">
        <table>
          <caption className="muted">
            Ladder standings for {String(event.name)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Entrant</th>
              <th scope="col">Points</th>
              <th scope="col">Played</th>
              <th scope="col">W–L</th>
              <th scope="col">Movement</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => {
              // Movement is the change since the previous week close. A team
              // with no earlier position is shown as new, not as zero movement.
              const baseline = (
                event.ladderState?.movementBaseline as
                  Record<string, number> | undefined
              )?.[s.teamId];
              const change =
                typeof baseline === "number" ? baseline - s.position : null;
              return (
                <tr key={s.teamId}>
                  <td>{s.position}</td>
                  <td>{name(s.teamId)}</td>
                  <td>{s.points}</td>
                  <td>{s.played}</td>
                  <td>
                    {s.wins}–{s.losses}
                  </td>
                  <td>
                    {change === null
                      ? "No prior week"
                      : change > 0
                        ? `▲ ${change}`
                        : change < 0
                          ? `▼ ${-change}`
                          : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
function LadderStandings() {
  const events = useList("events", [
    ["visibility", "==", "public"],
    ["status", "!=", "Draft"],
  ]);
  if (events.isLoading) return <p role="status">Loading ladder standings…</p>;
  if (events.error)
    return (
      <p className="error" role="alert">
        {events.error.message}
      </p>
    );
  const seasons = (events.data ?? []).filter(
    (e) => e.competition === "ladder" && e.ladderState?.standings?.length,
  );
  if (!seasons.length)
    return (
      <Empty title="No ladder standings yet">
        Standings appear once a ladder season has played its first results.
      </Empty>
    );
  return (
    <section aria-label="Ladder standings">
      {seasons.map((e) => (
        <LadderSeasonTable key={e.id} event={e} />
      ))}
    </section>
  );
}
export function Rankings() {
  const [metric, setMetric] = useState<"singles" | "doubles">("singles"),
    players = useList("publicProfiles", [["clubId", "==", "pprc"]]);
  const rows = referenceLeaderboard(players.data ?? [], metric);
  return (
    <div className="page">
      <p className="eyebrow">
        <Trophy size={15} /> PPRC RANKINGS
      </p>
      <h1>Ladder standings</h1>
      <p className="lead">
        Server-computed positions from PPRC ladder seasons. Reference ratings
        are listed separately below.
      </p>
      <LadderStandings />
      <h2>Reference leaderboard</h2>
      <p className="lead">
        A directory ranking of player-provided or club-admin-verified values.
      </p>
      <p className="muted">
        This list sorts authorized public references. It is separate from PPRC
        event results and does not calculate or certify official UTR ratings.
        Equal references share a rank.
      </p>
      <Field label="Leaderboard reference">
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value as "singles" | "doubles")}
        >
          <option value="singles">Singles reference</option>
          <option value="doubles">Doubles reference</option>
        </select>
      </Field>
      {players.error && (
        <p className="error" role="alert">
          {players.error.message}
        </p>
      )}
      <Panel>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>City</th>
                <th>Reference</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.playerId}>
                  <td>
                    <span className="rank-number">{row.rank}</span>
                  </td>
                  <td>
                    <Link className="text-link" to={`/players/${row.playerId}`}>
                      {row.displayName}
                    </Link>
                  </td>
                  <td>{row.city}</td>
                  <td>
                    <strong>{row.reference.toFixed(2)}</strong>
                  </td>
                  <td>{row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty title="No public references yet" />}
      </Panel>
      <Link className="button secondary" to="/players">
        Back to player search
      </Link>
    </div>
  );
}
