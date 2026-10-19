import Link from "next/link";
import { searchPlayers, states, fullName, ageOf } from "@/lib/queries";
import { PlayerFilters } from "@/components/filters";
import { Avatar, RatingChip } from "@/components/ui";

export default async function PlayersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const players = searchPlayers({ q: sp.q, gender: sp.gender, state: sp.state, ageGroup: sp.age, limit: 100 });
  return (
    <div>
      <h1 className="mb-6 text-[48px]">Players</h1>
      <PlayerFilters action="/players" values={sp} states={states()} />
      <p className="mb-3 text-sm text-muted">
        {players.length === 100 ? "Showing the first 100 matches. Narrow the filters to see more." : `${players.length} players`}
      </p>
      {players.length === 0 ? (
        <p>
          No players match that search. Try a shorter name, or <Link href="/join" className="text-court underline">create a profile</Link>.
        </p>
      ) : (
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {players.map((p) => (
            <li key={p.id} className="flex items-center gap-3 border-b border-line py-3">
              <Avatar name={fullName(p)} url={p.avatar_url} />
              <div className="min-w-0 flex-1">
                <Link href={`/players/${p.id}`} className="font-semibold hover:underline">{fullName(p)}</Link>
                <div className="truncate text-sm text-muted">
                  {p.gender === "M" ? "M" : "F"}{ageOf(p.birth_year)}, {p.club_name ?? `${p.city}, ${p.state}`}
                </div>
              </div>
              <RatingChip rating={p.rating} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
