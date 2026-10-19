import Link from "next/link";
import { searchPlayers, upcomingEvents, recentMatches, fullName } from "@/lib/queries";
import { currentPlayer } from "@/lib/session";
import { MatchTable, RatingChip, SectionTitle, shortDate } from "@/components/ui";

const SCALE_MARKS: [number, string][] = [
  [2, "First lessons"],
  [4, "JV / 3.0 league"],
  [6.5, "4.0 league"],
  [8, "Varsity"],
  [11, "College"],
  [13.5, "Division I"],
  [16, "Tour"],
];

export default async function Home() {
  const me = await currentPlayer();
  const top = searchPlayers({ limit: 8 });
  const events = upcomingEvents(5);
  const results = recentMatches(6);
  const pos = (r: number) => `${((r - 1) / 15.5) * 100}%`;

  return (
    <div className="space-y-14">
      <section className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-end">
        <div>
          <h1 className="text-[52px] md:text-[68px]">Every game you win counts.</h1>
          <p className="mt-3 max-w-[56ch] text-[19px] text-muted">
            Baseline rates players on one scale from beginner to tour, using the share of games you win against opponents of a known level.
            Add a result and your rating updates straight away.
          </p>
          <form action="/players" className="mt-6 flex max-w-lg gap-2">
            <label htmlFor="q" className="sr-only">Search players</label>
            <input id="q" name="q" className="field" placeholder="Search players, clubs or cities" />
            <button className="btn">Search</button>
          </form>
          {!me && (
            <p className="mt-4 text-[15px]">
              New here? <Link href="/join" className="font-semibold text-court underline">Create your profile</Link> or{" "}
              <Link href="/signin" className="font-semibold text-court underline">sign in as a sample player</Link>.
            </p>
          )}
        </div>
        <figure aria-label="The Baseline scale">
          <div className="relative h-[150px]">
            <div className="absolute inset-x-0 top-[62px] h-[26px] rounded-sm bg-court">
              <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-chalk/80" />
            </div>
            {SCALE_MARKS.map(([r, label], i) => (
              <div key={r} className="absolute" style={{ left: pos(r) }}>
                <div className={`absolute h-[18px] w-[2px] bg-ink ${i % 2 ? "top-[90px]" : "top-[42px]"}`} />
                <span className={`num absolute -translate-x-1/2 whitespace-nowrap text-[13px] ${i % 2 ? "top-[110px]" : "top-[0px]"}`}>
                  <b className="text-[17px]">{r}</b>
                  <br />
                  <span className="text-muted">{label}</span>
                </span>
              </div>
            ))}
            {me?.rating != null && (
              <div className="absolute top-[56px]" style={{ left: pos(me.rating) }}>
                <div className="h-[38px] w-[38px] -translate-x-1/2 rounded-full border-[3px] border-court-deep bg-ball" title={`You: ${me.rating.toFixed(2)}`} />
              </div>
            )}
          </div>
          <figcaption className="mt-2 text-sm text-muted">
            {me?.rating != null ? `You're at ${me.rating.toFixed(2)}.` : "One scale, 1.00 to 16.50, for juniors and adults alike."}
          </figcaption>
        </figure>
      </section>

      <div className="grid gap-12 lg:grid-cols-[1fr_380px]">
        <section>
          <SectionTitle action={<Link href="/leaderboard" className="text-sm font-semibold text-court underline">Full rankings</Link>}>
            Highest rated
          </SectionTitle>
          <table className="sheet">
            <tbody>
              {top.map((p, i) => (
                <tr key={p.id}>
                  <td className="num w-8 text-muted">{i + 1}</td>
                  <td>
                    <Link href={`/players/${p.id}`} className="font-semibold hover:underline">{fullName(p)}</Link>
                    <span className="block text-sm text-muted">{p.club_name ?? `${p.city}, ${p.state}`}</span>
                  </td>
                  <td className="text-right"><RatingChip rating={p.rating} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <SectionTitle action={<Link href="/events" className="text-sm font-semibold text-court underline">All events</Link>}>
            Coming up
          </SectionTitle>
          <ul className="divide-y divide-line border-t-2 border-ink">
            {events.map((e) => (
              <li key={e.id} className="py-3">
                <Link href={`/events/${e.id}`} className="font-semibold hover:underline">{e.name}</Link>
                <div className="text-sm text-muted">
                  {shortDate(e.start_date)} in {e.city}. Level <span className="num">{e.min_rating}–{e.max_rating}</span>, {e.registered} entered.
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <SectionTitle>Latest results</SectionTitle>
        <MatchTable matches={results} />
      </section>
    </div>
  );
}
