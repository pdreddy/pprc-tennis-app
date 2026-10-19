import Link from "next/link";
import { searchPlayers, fullName } from "@/lib/queries";
import { signIn } from "@/app/actions";

export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const players = searchPlayers({ limit: 300 });
  return (
    <div className="max-w-xl">
      <h1 className="text-[48px]">Sign in</h1>
      <p className="mb-6 mt-1 text-muted">
        This build uses demo sign-in: pick any sample player to act as them. <Link href="/join" className="text-court underline">Create your own profile</Link> instead if you prefer.
      </p>
      <form action={signIn} className="space-y-4">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <label className="label" htmlFor="player_id">Player</label>
        <select id="player_id" name="player_id" className="field" required defaultValue="">
          <option value="" disabled>Choose a player</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>{fullName(p)}, {p.city} ({p.rating?.toFixed(2) ?? "unrated"})</option>
          ))}
        </select>
        <button className="btn">Sign in</button>
      </form>
    </div>
  );
}
