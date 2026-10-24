import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowUpRight, Trophy } from "lucide-react";
import { useList, useSession } from "./context";
import { call } from "./firebase";
import { referenceLeaderboard, type PerformanceRecord } from "@pprc/shared";
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
export function Rankings() {
  const [metric, setMetric] = useState<"singles" | "doubles">("singles"),
    players = useList("publicProfiles", [["clubId", "==", "pprc"]]);
  const rows = referenceLeaderboard(players.data ?? [], metric);
  return (
    <div className="page">
      <p className="eyebrow">
        <Trophy size={15} /> PPRC PLAYER REFERENCES
      </p>
      <h1>Reference leaderboard</h1>
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
