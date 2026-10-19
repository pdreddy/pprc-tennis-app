"use client";

import { useActionState, useMemo, useState } from "react";
import { recordMatch } from "@/app/actions";

type P = { id: number; name: string; rating: number | null };

function PlayerPicker({ name, label, players, defaultId }: { name: string; label: string; players: P[]; defaultId?: number }) {
  const [q, setQ] = useState("");
  const [id, setId] = useState<number | undefined>(defaultId);
  const options = useMemo(
    () => players.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 200),
    [q, players],
  );
  return (
    <div>
      <label className="label" htmlFor={`${name}-search`}>{label}</label>
      <input
        id={`${name}-search`}
        className="field mb-2"
        placeholder="Type to filter"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <select name={name} className="field" value={id ?? ""} onChange={(e) => setId(Number(e.target.value))} required aria-label={label}>
        <option value="" disabled>Choose a player</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.rating?.toFixed(2) ?? "unrated"})
          </option>
        ))}
      </select>
    </div>
  );
}

export function MatchForm({ players, meId, events }: { players: P[]; meId?: number; events: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(recordMatch, undefined);
  const today = new Date().toISOString().slice(0, 10);
  // React resets uncontrolled fields after an action; re-mount with what was submitted.
  const v = state?.values ?? {};
  return (
    <form action={action} className="max-w-2xl space-y-6" key={JSON.stringify(v)}>
      <div className="grid gap-6 sm:grid-cols-2">
        <PlayerPicker name="p1" label="Player 1" players={players} defaultId={Number(v.p1) || meId} />
        <PlayerPicker name="p2" label="Player 2" players={players} defaultId={Number(v.p2) || undefined} />
      </div>
      <div>
        <label className="label" htmlFor="score">Score, from player 1&apos;s side</label>
        <input id="score" name="score" className="field num text-[22px]" placeholder="6-4 3-6 10-8" defaultValue={v.score} required aria-describedby="score-help" />
        <p id="score-help" className="mt-1 text-sm text-muted">Separate sets with spaces. Write a third-set match tiebreak as 10-8.</p>
      </div>
      <div className="grid gap-6 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="played_on">Date played</label>
          <input id="played_on" name="played_on" type="date" max={today} defaultValue={v.played_on || today} className="field" required />
        </div>
        <div>
          <label className="label" htmlFor="format">Format</label>
          <select id="format" name="format" className="field" defaultValue={v.format || "best_of_3"}>
            <option value="best_of_3">Best of 3 sets</option>
            <option value="best_of_5">Best of 5 sets</option>
            <option value="pro_set">Pro set (8 games)</option>
            <option value="one_set">One set</option>
            <option value="tiebreak_10">10-point tiebreak only</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="event_id">Event (optional)</label>
          <select id="event_id" name="event_id" className="field" defaultValue={v.event_id || ""}>
            <option value="">Not part of an event</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="retired" defaultChecked={v.retired === "on"} /> Someone retired or the match was cut short
      </label>
      {state?.error && <p className="rounded bg-loss/10 px-3 py-2 text-loss" role="alert">{state.error}</p>}
      <button className="btn" disabled={pending}>{pending ? "Saving and updating ratings…" : "Save result"}</button>
    </form>
  );
}
