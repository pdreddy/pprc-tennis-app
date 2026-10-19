"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function UploadForm({ players, defaultPlayer, live }: { players: { id: number; name: string }[]; defaultPlayer?: number; live: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <form
      className="max-w-xl space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          const res = await fetch("/api/analyze", { method: "POST", body: new FormData(e.currentTarget) });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error);
          router.push(`/analyze/${json.id}`);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <div>
        <label className="label" htmlFor="video">Video clip</label>
        <input id="video" name="video" type="file" accept="video/*" className="field" required />
        <p className="mt-1 text-sm text-muted">MP4, MOV or WebM, up to 100 MB. Two to ten minutes from behind the baseline works best.</p>
      </div>
      <div>
        <label className="label" htmlFor="player_id">Whose game is it?</label>
        <select id="player_id" name="player_id" className="field" defaultValue={defaultPlayer ?? ""}>
          <option value="">No profile</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="notes">Anything to focus on? (optional)</label>
        <textarea id="notes" name="notes" rows={3} className="field" placeholder="My backhand breaks down when I'm pulled wide" />
      </div>
      {error && <p className="rounded bg-loss/10 px-3 py-2 text-loss" role="alert">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? (live ? "Uploading and watching the video… this can take a minute or two" : "Reviewing…") : "Review video"}</button>
    </form>
  );
}
