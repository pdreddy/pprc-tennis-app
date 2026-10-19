import Link from "next/link";
import { notFound } from "next/navigation";
import { getMatch, matchRatingsFor, fmtRating, getPlayer } from "@/lib/queries";
import { expectedShare } from "@/lib/rating";
import { Avatar, shortDate } from "@/components/ui";
import { CardButton } from "@/components/ai-buttons";

export default async function MatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const m = getMatch(Number(id));
  if (!m) notFound();
  const mr = matchRatingsFor(m.id);
  const a = getPlayer(m.p1)!;
  const b = getPlayer(m.p2)!;
  const sets = m.score.split(" ").map((s) => s.split("-"));
  const total = m.p1_games + m.p2_games;
  const exp = a.rating != null && b.rating != null ? expectedShare(a.rating - b.rating) : null;

  const row = (p: typeof a, side: 0 | 1, games: number) => (
    <tr className={m.winner === p.id ? "font-semibold" : "text-muted"}>
      <td className="py-3 pr-4">
        <Link href={`/players/${p.id}`} className="flex items-center gap-3 hover:underline">
          <Avatar name={`${p.first_name} ${p.last_name}`} url={p.avatar_url} size={36} />
          {p.first_name} {p.last_name}
          {m.winner === p.id && <span className="h-3 w-3 rounded-full bg-ball ring-2 ring-court-deep" aria-label="Winner" />}
        </Link>
      </td>
      {sets.map((s, i) => (
        <td key={i} className="num w-14 text-center text-[34px]">{s[side].replace(/\(.*/, "")}</td>
      ))}
      <td className="num pl-6 text-right text-[17px]">{games}/{total} games</td>
    </tr>
  );

  return (
    <div className="max-w-3xl space-y-10">
      {sp.recorded && <p className="rounded bg-ball/40 px-4 py-3">Result saved. Both ratings have been updated.</p>}
      <div>
        <p className="text-muted">
          {shortDate(m.played_on)}, {m.event_id ? <Link href={`/events/${m.event_id}`} className="underline">{m.event_name}</Link> : m.source === "league" ? "League match" : "Reported match"}
          , {m.format.replace(/_/g, " ")}
        </p>
        <table className="mt-3 w-full border-y-2 border-ink">
          <tbody>
            {row(a, 0, m.p1_games)}
            {row(b, 1, m.p2_games)}
          </tbody>
        </table>
      </div>

      <section>
        <h2 className="mb-3 text-[30px]">How this match rated</h2>
        <p className="mb-4 max-w-[64ch] text-muted">
          A match rating is the level each player played at in this match: the opponent&apos;s rating, adjusted by the share of games won.
          {exp != null && ` Going in, ${a.first_name} was expected to win about ${Math.round(exp * 100)}% of games and won ${Math.round((m.p1_games / total) * 100)}%.`}
        </p>
        <table className="sheet max-w-md">
          <thead>
            <tr><th>Player</th><th className="text-right">Current rating</th><th className="text-right">Match rating</th></tr>
          </thead>
          <tbody>
            {[a, b].map((p) => (
              <tr key={p.id}>
                <td>{p.first_name} {p.last_name}</td>
                <td className="num text-right text-[18px]">{fmtRating(p.rating)}</td>
                <td className="num text-right text-[18px] font-semibold">{fmtRating(mr.get(p.id))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {mr.size === 0 && <p className="mt-2 text-sm text-muted">This match is older than 12 months, so it no longer counts towards ratings.</p>}
      </section>

      <section>
        <h2 className="mb-3 text-[30px]">Share it</h2>
        <p className="mb-4 text-muted">Make an image of this result for social or the club group chat.</p>
        <CardButton matchId={m.id} />
      </section>
    </div>
  );
}
