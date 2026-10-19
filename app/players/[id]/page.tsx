import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlayer, playerMatches, playerStats, ratingHistory, playerMedia, fullName, ageOf } from "@/lib/queries";
import { currentPlayer } from "@/lib/session";
import { Avatar, MatchTable, RatingChart, RatingPlate, SectionTitle } from "@/components/ui";
import { AvatarButton } from "@/components/ai-buttons";
import { signIn } from "@/app/actions";

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const p = getPlayer(Number(id));
  if (!p) notFound();
  const me = await currentPlayer();
  const isMe = me?.id === p.id;
  const stats = playerStats(p.id);
  const history = ratingHistory(p.id);
  const matches = playerMatches(p.id, 40);
  const cards = playerMedia(p.id).filter((m) => m.kind === "card");
  const change = history.length > 1 ? history[history.length - 1].rating - history[0].rating : null;

  return (
    <div className="space-y-12">
      {sp.welcome && (
        <p className="rounded bg-ball/40 px-4 py-3">
          Your profile is live with a starting estimate of {p.seed_rating.toFixed(1)}. Add your first result to get a real rating.{" "}
          <Link href="/matches/new" className="font-semibold underline">Add a result</Link>
        </p>
      )}

      <section className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-5">
          <Avatar name={fullName(p)} url={p.avatar_url} size={96} />
          <div>
            <h1 className="text-[52px]">{fullName(p)}</h1>
            <p className="text-muted">
              {p.gender === "M" ? "Male" : "Female"}, {ageOf(p.birth_year)}. {p.city}, {p.state}.{" "}
              {p.club_id && <Link href={`/clubs/${p.club_id}`} className="underline">{p.club_name}</Link>}
            </p>
            <p className="text-sm text-muted">{p.plays}-handed, {p.backhand.toLowerCase()} backhand</p>
            {!isMe && (
              <form action={signIn} className="mt-2">
                <input type="hidden" name="player_id" value={p.id} />
                <button className="text-sm text-court underline">Sign in as this sample player</button>
              </form>
            )}
          </div>
        </div>
        <RatingPlate rating={p.rating} reliability={p.reliability} />
      </section>

      <section className="grid grid-cols-2 gap-y-6 border-y-2 border-ink py-5 sm:grid-cols-4">
        {[
          ["Last 12 months", `${stats.wins}–${stats.losses}`],
          ["Games won", `${Math.round(stats.gameShare * 100)}%`],
          ["Upset wins", String(stats.upsetWins)],
          ["12-month change", change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}`],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="num text-[40px] font-bold leading-none">{value}</div>
            <div className="text-sm text-muted">{label}</div>
          </div>
        ))}
      </section>

      <div className="grid gap-12 lg:grid-cols-[1fr_320px]">
        <section>
          <SectionTitle>Rating, past year</SectionTitle>
          <RatingChart points={history} />
        </section>
        <aside className="space-y-5">
          <h2 className="text-[30px]">Tools</h2>
          <Link href={`/coach?player=${p.id}`} className="btn w-full justify-center">Ask the coach about {isMe ? "my" : `${p.first_name}'s`} game</Link>
          <Link href={`/analyze?player=${p.id}`} className="btn btn-quiet w-full justify-center">Review a match video</Link>
          {isMe && (
            <div>
              <p className="mb-2 text-sm text-muted">Profile picture</p>
              <AvatarButton playerId={p.id} />
            </div>
          )}
        </aside>
      </div>

      <section>
        <SectionTitle action={isMe ? <Link href="/matches/new" className="text-sm font-semibold text-court underline">Add a result</Link> : undefined}>
          Results
        </SectionTitle>
        <MatchTable matches={matches} forPlayer={p.id} />
      </section>

      {cards.length > 0 && (
        <section>
          <SectionTitle>Result cards</SectionTitle>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {cards.map((c) => (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={c.id} href={c.url} target="_blank"><img src={c.url} alt="Result card" className="h-[260px] rounded shadow" /></a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
