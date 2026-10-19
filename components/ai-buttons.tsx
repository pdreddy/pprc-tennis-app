"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Something went wrong");
  return json;
}

export function AvatarButton({ playerId }: { playerId: number }) {
  const router = useRouter();
  const [style, setStyle] = useState("emblem");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="avatar-style" className="sr-only">Avatar style</label>
        <select id="avatar-style" value={style} onChange={(e) => setStyle(e.target.value)} className="field w-auto py-2">
          <option value="emblem">Club emblem</option>
          <option value="retro">Retro patch</option>
          <option value="minimal">Line drawing</option>
        </select>
        <button
          className="btn btn-quiet"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              await post("/api/avatar", { playerId, style });
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Generating…" : "Generate avatar"}
        </button>
      </div>
      {error && <p className="text-sm text-loss">{error}</p>}
    </div>
  );
}

export function CardButton({ matchId }: { matchId: number }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string>();
  const [mock, setMock] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="space-y-3">
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            const r = await post("/api/card", { matchId });
            setUrl(r.url);
            setMock(r.mock);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Making your card…" : url ? "Make another" : "Make a result card"}
      </button>
      {error && <p className="text-sm text-loss">{error}</p>}
      {url && (
        <figure className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Shareable result card" className="w-full max-w-[360px] rounded shadow-lg" />
          <figcaption className="flex gap-4 text-sm">
            <a href={url} download className="font-semibold text-court underline">Download</a>
            {mock && <span className="text-muted">Plain court background. Add a Replicate token for a generated photo.</span>}
          </figcaption>
        </figure>
      )}
    </div>
  );
}
