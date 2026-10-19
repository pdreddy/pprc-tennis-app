import Link from "next/link";
import { fmtRating, MatchRow } from "@/lib/queries";

/** The signature element: a rating set inside a half-court diagram. */
export function RatingPlate({ rating, reliability, size = "lg" }: { rating: number | null; reliability: number; size?: "lg" | "sm" }) {
  const big = size === "lg";
  return (
    <div className={`plate-in relative inline-block ${big ? "w-[260px]" : "w-[150px]"}`}>
      <svg viewBox="0 0 260 170" className="absolute inset-0 h-full w-full" aria-hidden>
        <rect x="3" y="3" width="254" height="164" fill="var(--color-court)" stroke="var(--color-chalk)" strokeWidth="3" />
        <line x1="3" y1="20" x2="257" y2="20" stroke="var(--color-chalk)" strokeWidth="2" opacity=".7" />
        <line x1="3" y1="150" x2="257" y2="150" stroke="var(--color-chalk)" strokeWidth="2" opacity=".7" />
        <line x1="226" y1="20" x2="226" y2="150" stroke="var(--color-chalk)" strokeWidth="2" opacity=".7" />
        <line x1="226" y1="85" x2="257" y2="85" stroke="var(--color-chalk)" strokeWidth="2" opacity=".7" />
      </svg>
      <div className={`relative flex flex-col justify-center ${big ? "h-[170px] pl-6" : "h-[98px] pl-4"}`}>
        <span className={`num font-bold leading-none text-white ${big ? "text-[84px]" : "text-[46px]"}`}>{fmtRating(rating)}</span>
        <span className={`mt-1 flex items-center gap-2 text-white/85 ${big ? "text-sm" : "text-xs"}`}>
          <span className="relative block h-[6px] w-[70px] rounded bg-white/25">
            <span className="absolute inset-y-0 left-0 rounded bg-ball" style={{ width: `${reliability}%` }} />
          </span>
          {reliability}% reliable
        </span>
      </div>
    </div>
  );
}

export function RatingChip({ rating }: { rating: number | null }) {
  return (
    <span className="num inline-block min-w-[3.6em] rounded bg-court px-2 py-0.5 text-center text-[17px] font-semibold text-white">
      {fmtRating(rating)}
    </span>
  );
}

export function Avatar({ name, url, size = 44 }: { name: string; url?: string | null; size?: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("");
  return (
    <span
      className="num inline-flex shrink-0 items-center justify-center rounded-full bg-court-deep font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** Score from the point of view of `forPlayer` (their games first). */
export function scoreFor(m: MatchRow, forPlayer?: number) {
  if (!forPlayer || m.p1 === forPlayer) return m.score;
  return m.score
    .split(" ")
    .map((s) => s.split("-").reverse().join("-"))
    .join(" ");
}

export function MatchTable({ matches, forPlayer }: { matches: MatchRow[]; forPlayer?: number }) {
  if (matches.length === 0) return <p className="text-muted">No results yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="sheet min-w-[560px]">
        <thead>
          <tr>
            <th>Date</th>
            {forPlayer ? <th>Result</th> : <th>Winner</th>}
            <th>{forPlayer ? "Opponent" : "Loser"}</th>
            <th>Score</th>
            <th className="hidden md:table-cell">Event</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const won = forPlayer ? m.winner === forPlayer : true;
            const opp = forPlayer ? (m.p1 === forPlayer ? { id: m.p2, name: m.p2_name, r: m.p2_rating } : { id: m.p1, name: m.p1_name, r: m.p1_rating }) : null;
            const w = m.winner === m.p1 ? { id: m.p1, name: m.p1_name, r: m.p1_rating } : { id: m.p2, name: m.p2_name, r: m.p2_rating };
            const l = m.winner === m.p1 ? { id: m.p2, name: m.p2_name, r: m.p2_rating } : { id: m.p1, name: m.p1_name, r: m.p1_rating };
            return (
              <tr key={m.id}>
                <td className="num whitespace-nowrap text-muted">{shortDate(m.played_on)}</td>
                {forPlayer ? (
                  <td>
                    <span className={`num font-bold ${won ? "text-apron" : "text-loss"}`}>{won ? "W" : "L"}</span>
                  </td>
                ) : (
                  <td>
                    <Link href={`/players/${w.id}`} className="font-semibold hover:underline">{w.name}</Link>{" "}
                    <span className="num text-muted">{fmtRating(w.r)}</span>
                  </td>
                )}
                <td>
                  {forPlayer && opp ? (
                    <>
                      <Link href={`/players/${opp.id}`} className="font-semibold hover:underline">{opp.name}</Link>{" "}
                      <span className="num text-muted">{fmtRating(opp.r)}</span>
                    </>
                  ) : (
                    <>
                      <Link href={`/players/${l.id}`} className="hover:underline">{l.name}</Link>{" "}
                      <span className="num text-muted">{fmtRating(l.r)}</span>
                    </>
                  )}
                </td>
                <td>
                  <Link href={`/matches/${m.id}`} className="num whitespace-nowrap text-[18px] hover:underline">
                    {forPlayer ? scoreFor(m, forPlayer) : scoreFor(m, m.winner)}
                  </Link>
                </td>
                <td className="hidden text-sm text-muted md:table-cell">
                  {m.event_id ? <Link href={`/events/${m.event_id}`} className="hover:underline">{m.event_name}</Link> : m.source === "league" ? "League" : "Reported"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function shortDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function RatingChart({ points }: { points: { as_of: string; rating: number }[] }) {
  if (points.length < 2) return <p className="text-sm text-muted">Your rating history appears after a few months of results.</p>;
  const W = 640, H = 200, P = 34;
  const rs = points.map((p) => p.rating);
  const lo = Math.floor(Math.min(...rs) - 0.3);
  const hi = Math.ceil(Math.max(...rs) + 0.3);
  const x = (i: number) => P + (i * (W - P * 2)) / (points.length - 1);
  const y = (r: number) => H - P + 10 - ((r - lo) / (hi - lo || 1)) * (H - P * 1.6);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((_, i, a) => a.length <= 6 || i % 2 === 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Rating moved from ${rs[0].toFixed(2)} to ${rs[rs.length - 1].toFixed(2)} over the last year`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={P} x2={W - P} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
          <text x={P - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--color-muted)" className="num">{t}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--color-court)" strokeWidth="3" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={p.as_of} cx={x(i)} cy={y(p.rating)} r={i === points.length - 1 ? 6 : 3.5} fill={i === points.length - 1 ? "var(--color-ball)" : "var(--color-court)"} stroke="var(--color-court-deep)" strokeWidth={i === points.length - 1 ? 2 : 0}>
          <title>{`${p.as_of}: ${p.rating.toFixed(2)}`}</title>
        </circle>
      ))}
      {points.map((p, i) =>
        i % 2 === 0 || i === points.length - 1 ? (
          <text key={`l${i}`} x={x(i)} y={H - 4} textAnchor="middle" fontSize="12" fill="var(--color-muted)">
            {new Date(p.as_of + "T12:00:00").toLocaleDateString("en-US", { month: "short" })}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="text-[30px]">{children}</h2>
      {action}
    </div>
  );
}

export function MockNote() {
  return (
    <p className="rounded border border-dashed border-muted/50 bg-white px-3 py-2 text-sm text-muted">
      Sample output. Add <code>REPLICATE_API_TOKEN</code> to <code>.env.local</code> to run the real models.
    </p>
  );
}
