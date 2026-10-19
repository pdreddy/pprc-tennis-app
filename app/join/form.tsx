"use client";

import { useActionState } from "react";
import { createProfile } from "@/app/actions";

const LEVELS: [string, string][] = [
  ["new", "Just starting: learning to rally"],
  ["beginner", "Beginner: can rally and serve, new to matches"],
  ["intermediate", "Intermediate: 3.0–3.5 league or middle-school team"],
  ["advanced-league", "Strong club: 4.0–4.5 league or JV"],
  ["varsity", "Varsity or 5.0 league"],
  ["college", "Played or plays college tennis"],
  ["pro", "Professional or top national junior"],
];

export function JoinForm({ clubs }: { clubs: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(createProfile, undefined);
  const v = state?.values ?? {};
  return (
    <form action={action} className="max-w-xl space-y-5" key={JSON.stringify(v)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="first_name">First name</label><input id="first_name" name="first_name" defaultValue={v.first_name} className="field" required autoComplete="given-name" /></div>
        <div><label className="label" htmlFor="last_name">Last name</label><input id="last_name" name="last_name" defaultValue={v.last_name} className="field" required autoComplete="family-name" /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="gender">Division</label>
          <select id="gender" name="gender" className="field" required defaultValue={v.gender ?? ""}>
            <option value="" disabled>Choose</option>
            <option value="M">Men / boys</option>
            <option value="F">Women / girls</option>
          </select>
        </div>
        <div><label className="label" htmlFor="birth_year">Birth year</label><input id="birth_year" name="birth_year" defaultValue={v.birth_year} type="number" className="field" required /></div>
        <div>
          <label className="label" htmlFor="plays">Plays</label>
          <select id="plays" name="plays" className="field" defaultValue={v.plays}><option>Right</option><option>Left</option></select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div><label className="label" htmlFor="city">City</label><input id="city" name="city" defaultValue={v.city} className="field" required /></div>
        <div><label className="label" htmlFor="state">State</label><input id="state" name="state" defaultValue={v.state} maxLength={2} className="field uppercase" required /></div>
      </div>
      <div>
        <label className="label" htmlFor="club_id">Home club</label>
        <select id="club_id" name="club_id" className="field" defaultValue={v.club_id ?? ""}>
          <option value="">None</option>
          {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <fieldset>
        <legend className="label">Which sounds most like you?</legend>
        <p className="mb-2 text-sm text-muted">This only sets a starting point. Your results take over after a few matches.</p>
        <div className="space-y-1">
          {LEVELS.map(([val, label]) => (
            <label key={val} className="flex items-center gap-2"><input type="radio" name="level" value={val} defaultChecked={v.level === val} required /> {label}</label>
          ))}
        </div>
      </fieldset>
      <input type="hidden" name="backhand" value="Two-handed" />
      {state?.error && <p className="rounded bg-loss/10 px-3 py-2 text-loss" role="alert">{state.error}</p>}
      <button className="btn" disabled={pending}>{pending ? "Creating…" : "Create profile"}</button>
    </form>
  );
}
