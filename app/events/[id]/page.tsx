import Link from "next/link";
import { notFound } from "next/navigation";
import { getEvent, eventEntrants, eventMatches, fullName, MatchRow } from "@/lib/queries";
import { currentPlayer } from "@/lib/session";
import { registerForEvent, withdrawFromEvent } from "@/app/actions";
import { RatingChip, shortDate, scoreFor } from "@/components/ui";

const ROUND_NAMES: Record<number, string> = { 1: "Final", 2: "Semifinals", 4: "Quarterfinals", 8: "Round of 16", 16: "Round of 32" };

function rounds(matches: MatchRow[]) {
  // Draw matches were inserted round by round; split them by halving counts.
  const out: MatchRow[][] = [];
  let i = 0;
  let size = 1;
  while (size * 2 <= matches.length + 1) size *= 2;
  while (i < matches.length && size >= 1) {
    out.push(matches.slice(i, i + size));
    i += size;
    size /= 2;
  }
  return out;
}

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const e = getEvent(Number(id));
  if (!e) notFound();
  const me = await currentPlayer();
  const entrants = eventEntrants(e.id);
  const matches = eventMatches(e.id);
  const upcoming = e.end_date >= new Date().toISOString().slice(0, 10);
  const entered = !!me && entrants.some((p) => p.id === me.id);
  const r = me?.rating ?? null;
  const eligible = r != null && r >= e.min_rating && r <= e.max_rating && (e.gender === "Open" || (e.gender === "Men") === (me?.gender === "M"));
  const full = entrants.length >= e.draw_size;

  return (
    <div className="space-y-10">
      {sp.registered && <p className="rounded bg-ball/40 px-4 py-3">You&apos;re entered. The draw is made by rating when entries close.</p>}
      <div className="grid gap-8 md:grid-cols-[1fr_300px]">
        <div>
          <h1 className="text-[46px]">{e.name}</h1>
          <p className="mt-2 text-muted">
            {shortDate(e.start_date)} to {shortDate(e.end_date)}. {e.club_id ? <Link href={`/clubs/${e.club_id}`} className="underline">{e.club_name}</Link> : null}, {e.city}, {e.state}.
          </p>
          <p className="mt-4 max-w-[60ch]">{e.description}</p>
        </div>
        <dl className="grid grid-cols-2 gap-4 border-t-2 border-ink pt-4">
          <div><dt className="text-sm text-muted">Level</dt><dd className="num text-[28px] font-bold">{e.min_rating}–{e.max_rating}</dd></div>
          <div><dt className="text-sm text-muted">Division</dt><dd className="text-[20px] font-semibold">{e.gender}</dd></div>
          <div><dt className="text-sm text-muted">Entries</dt><dd className="num text-[28px] font-bold">{entrants.length}/{e.draw_size}</dd></div>
          <div><dt className="text-sm text-muted">Entry fee</dt><dd className="num text-[28px] font-bold">${e.entry_fee}</dd></div>
          {upcoming && (
            <div className="col-span-2">
              {!me ? (
                <Link href={`/signin?next=/events/${e.id}`} className="btn w-full justify-center">Sign in to enter</Link>
              ) : entered ? (
                <form action={withdrawFromEvent}>
                  <input type="hidden" name="event_id" value={e.id} />
                  <button className="btn btn-quiet w-full justify-center">Withdraw</button>
                </form>
              ) : eligible && !full ? (
                <form action={registerForEvent}>
                  <input type="hidden" name="event_id" value={e.id} />
                  <button className="btn w-full justify-center">Enter for ${e.entry_fee}</button>
                  <p className="mt-1 text-xs text-muted">Payment is collected at check-in in this demo.</p>
                </form>
              ) : (
                <p className="text-sm text-muted">
                  {full ? "The draw is full." : `Your rating (${r?.toFixed(2) ?? "unrated"}) or division doesn't fit this event. Look for one marked "Your level" on the Events page.`}
                </p>
              )}
            </div>
          )}
        </dl>
      </div>

      {matches.length > 0 ? (
        <section>
          <h2 className="mb-4 text-[30px]">Draw results</h2>
          <div className="flex gap-6 overflow-x-auto pb-2">
            {rounds(matches).map((rd) => (
              <div key={rd[0].id} className="min-w-[240px]">
                <h3 className="mb-2 text-[20px]">{ROUND_NAMES[rd.length] ?? `Round of ${rd.length * 2}`}</h3>
                <ul className="space-y-3">
                  {rd.map((m) => {
                    const w = m.winner === m.p1 ? m.p1_name : m.p2_name;
                    const l = m.winner === m.p1 ? m.p2_name : m.p1_name;
                    return (
                      <li key={m.id} className="border-l-4 border-court bg-white px-3 py-2">
                        <Link href={`/matches/${m.id}`} className="block hover:underline">
                          <span className="font-semibold">{w}</span>
                          <span className="block text-sm text-muted">def. {l}</span>
                          <span className="num">{scoreFor(m, m.winner)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-[30px]">Entrants</h2>
        {entrants.length === 0 ? (
          <p className="text-muted">No entries yet. Be the first.</p>
        ) : (
          <ol className="grid gap-x-8 sm:grid-cols-2">
            {entrants.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 border-b border-line py-2">
                <span className="num w-6 text-muted">{i + 1}</span>
                <Link href={`/players/${p.id}`} className="flex-1 hover:underline">{fullName(p)}</Link>
                <RatingChip rating={p.rating} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
