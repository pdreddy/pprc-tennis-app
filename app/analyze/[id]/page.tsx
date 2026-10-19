import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import type { VideoAnalysis } from "@/lib/ai";
import { getPlayer, fullName } from "@/lib/queries";
import { MockNote } from "@/components/ui";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().prepare("SELECT * FROM analyses WHERE id = ?").get(Number(id)) as
    | { id: number; player_id: number | null; notes: string | null; result_json: string; mock: number; created_at: string }
    | undefined;
  if (!row) notFound();
  const a = JSON.parse(row.result_json) as VideoAnalysis;
  const player = row.player_id ? getPlayer(row.player_id) : undefined;

  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <h1 className="text-[46px]">Video review{player ? `: ${fullName(player)}` : ""}</h1>
        {row.notes && <p className="mt-1 text-muted">Focus: {row.notes}</p>}
        <p className="mt-4 max-w-[64ch] text-[19px]">{a.summary}</p>
        {row.mock ? <div className="mt-4"><MockNote /></div> : null}
      </div>

      <section>
        <h2 className="mb-3 text-[30px]">Shot by shot</h2>
        <table className="sheet">
          <thead><tr><th>Shot</th><th>Grade</th><th>What we saw</th></tr></thead>
          <tbody>
            {a.shots.map((s) => (
              <tr key={s.shot}>
                <td className="font-semibold">{s.shot}</td>
                <td>
                  <span className="flex gap-1" aria-label={`${s.grade} out of 5`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span key={n} className={`h-3 w-3 rounded-full ${n <= s.grade ? "bg-court" : "bg-line"}`} />
                    ))}
                  </span>
                </td>
                <td>{s.observations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-10 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-[30px]">Patterns</h2>
          <ul className="list-disc space-y-2 pl-5">{a.patterns.map((p) => <li key={p}>{p}</li>)}</ul>
        </section>
        <section>
          <h2 className="mb-3 text-[30px]">Worth rewatching</h2>
          <ol className="space-y-2">
            {a.moments.map((m) => (
              <li key={m.time} className="flex gap-3"><span className="num w-12 shrink-0 text-[18px] font-semibold text-court">{m.time}</span><span>{m.note}</span></li>
            ))}
          </ol>
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-[30px]">Drills for this week</h2>
        <ol className="space-y-4">
          {a.drills.map((d, i) => (
            <li key={d.name} className="border-l-4 border-ball bg-white px-4 py-3">
              <h3 className="text-[22px]">{i + 1}. {d.name}</h3>
              <p>{d.how}</p>
              <p className="text-sm text-muted">{d.why}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex gap-3">
        {player && <Link href={`/coach?player=${player.id}`} className="btn">Talk it through with the coach</Link>}
        <Link href="/analyze" className="btn btn-quiet">Review another clip</Link>
      </div>
    </div>
  );
}
