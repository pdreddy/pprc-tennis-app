import Link from "next/link";
import { getDb } from "@/lib/db";
import { allPlayersLite } from "@/lib/queries";
import { currentPlayer } from "@/lib/session";
import { isLive, MODELS } from "@/lib/replicate";
import { shortDate } from "@/components/ui";
import { UploadForm } from "./upload";

export default async function Analyze({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await currentPlayer();
  const defaultPlayer = Number(sp.player) || me?.id;
  const past = getDb()
    .prepare(
      `SELECT a.id, a.created_at, a.notes, p.first_name || ' ' || p.last_name AS name
       FROM analyses a LEFT JOIN players p ON p.id = a.player_id ORDER BY a.id DESC LIMIT 10`,
    )
    .all() as { id: number; created_at: string; notes: string | null; name: string | null }[];
  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_320px]">
      <div>
        <h1 className="text-[48px]">Video review</h1>
        <p className="mb-8 mt-1 max-w-[60ch] text-muted">
          Upload match or practice footage and get a shot-by-shot breakdown, timestamps worth rewatching and drills to fix what shows up.
          {isLive() ? ` Uses ${MODELS.video} on Replicate.` : " Running in sample mode until a Replicate token is added."}
        </p>
        <UploadForm players={allPlayersLite()} defaultPlayer={defaultPlayer} live={isLive()} />
      </div>
      <aside>
        <h2 className="mb-3 text-[26px]">Recent reviews</h2>
        {past.length === 0 ? (
          <p className="text-sm text-muted">Reviews you run will show up here.</p>
        ) : (
          <ul>
            {past.map((a) => (
              <li key={a.id} className="border-b border-line py-2">
                <Link href={`/analyze/${a.id}`} className="font-semibold hover:underline">{a.name ?? "Unassigned clip"}</Link>
                <span className="block text-sm text-muted">{shortDate(a.created_at.slice(0, 10))}{a.notes ? `: ${a.notes.slice(0, 50)}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
