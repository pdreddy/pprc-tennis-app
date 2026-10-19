import Link from "next/link";
import { searchPlayers, states, fullName, ageOf } from "@/lib/queries";
import { PlayerFilters } from "@/components/filters";
import { RatingChip } from "@/components/ui";

export default async function Leaderboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const players = searchPlayers({ gender: sp.gender, state: sp.state, ageGroup: sp.age, minRating: 0, limit: 100 }).filter(
    (p) => p.reliability >= 40,
  );
  const title = [sp.age, sp.gender === "M" ? "Men & boys" : sp.gender === "F" ? "Women & girls" : null, sp.state].filter(Boolean).join(", ");
  return (
    <div>
      <h1 className="text-[48px]">Rankings</h1>
      <p className="mb-6 mt-1 text-muted">
        {title || "Everyone"}. Players need at least 40% reliability to appear, which usually takes 4–6 recent matches.
      </p>
      <PlayerFilters action="/leaderboard" values={sp} states={states()} showQuery={false} />
      <div className="overflow-x-auto">
        <table className="sheet min-w-[560px]">
          <thead>
            <tr>
              <th className="w-12">#</th>
              <th>Player</th>
              <th>Age</th>
              <th className="hidden sm:table-cell">Club</th>
              <th className="text-right">Matches</th>
              <th className="text-right">Rating</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => (
              <tr key={p.id}>
                <td className="num text-[18px] text-muted">{i + 1}</td>
                <td>
                  <Link href={`/players/${p.id}`} className="font-semibold hover:underline">{fullName(p)}</Link>
                  <span className="block text-sm text-muted">{p.city}, {p.state}</span>
                </td>
                <td className="num">{ageOf(p.birth_year)}</td>
                <td className="hidden text-sm sm:table-cell">{p.club_name}</td>
                <td className="num text-right">{p.match_count}</td>
                <td className="text-right"><RatingChip rating={p.rating} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {players.length === 0 && <p className="mt-4">Nobody in this group has a reliable rating yet. Try a wider age group or another state.</p>}
    </div>
  );
}
