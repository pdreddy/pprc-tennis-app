import Link from "next/link";
import { getDb } from "@/lib/db";
import { getPlayer, fullName } from "@/lib/queries";
import { currentPlayer } from "@/lib/session";
import { isLive, MODELS } from "@/lib/replicate";
import { RatingPlate } from "@/components/ui";
import { CoachChat } from "./chat";

export default async function Coach({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await currentPlayer();
  const player = sp.player ? getPlayer(Number(sp.player)) : me;
  if (!player) {
    return (
      <div className="max-w-xl">
        <h1 className="text-[48px]">Coach</h1>
        <p className="mt-2">
          The coach gives advice from a player&apos;s own results. <Link href="/signin?next=/coach" className="text-court underline">Sign in</Link> or open
          any player&apos;s profile and choose &ldquo;Ask the coach&rdquo;.
        </p>
      </div>
    );
  }
  const history = (getDb()
    .prepare("SELECT role, content, mock FROM chat_messages WHERE player_id = ? ORDER BY id DESC LIMIT 20")
    .all(player.id) as { role: "user" | "assistant"; content: string; mock: number }[])
    .reverse()
    .map((m) => ({ role: m.role, content: m.content, mock: !!m.mock }));

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_300px]">
      <div>
        <h1 className="text-[48px]">Coach</h1>
        <p className="mb-4 text-muted">
          Talking about <Link href={`/players/${player.id}`} className="underline">{fullName(player)}</Link>
          {isLive() ? `, powered by ${MODELS.text} on Replicate.` : "."}
        </p>
        <CoachChat playerId={player.id} firstName={player.first_name} initial={history} live={isLive()} />
      </div>
      <aside className="space-y-4">
        <RatingPlate rating={player.rating} reliability={player.reliability} size="sm" />
        <p className="text-sm text-muted">The coach sees the rating, the last 12 months of results and the player&apos;s profile. Nothing else.</p>
      </aside>
    </div>
  );
}
