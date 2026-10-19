"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { parseScore, winnerOf, Format } from "@/lib/rating";
import { recomputeAll } from "@/lib/ratings-service";
import { currentPlayer } from "@/lib/session";
import { getEvent } from "@/lib/queries";

export async function signIn(formData: FormData) {
  const id = Number(formData.get("player_id"));
  if (id) (await cookies()).set("player_id", String(id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect(String(formData.get("next") || `/players/${id}`));
}

export async function signOut() {
  (await cookies()).delete("player_id");
  redirect("/");
}

export type FormState = { error?: string; values?: Record<string, string> } | undefined;

const keep = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === "string" && !k.startsWith("$")).map(([k, v]) => [k, String(v)]));

const LEVELS: Record<string, number> = {
  "new": 1.5,
  "beginner": 2.5,
  "intermediate": 4.5,
  "advanced-league": 6.5,
  "varsity": 8,
  "college": 11,
  "pro": 14,
};

export async function createProfile(_: FormState, formData: FormData): Promise<FormState> {
  const first = String(formData.get("first_name") ?? "").trim();
  const last = String(formData.get("last_name") ?? "").trim();
  const gender = String(formData.get("gender"));
  const birthYear = Number(formData.get("birth_year"));
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim().toUpperCase();
  const level = LEVELS[String(formData.get("level"))];
  const clubId = Number(formData.get("club_id")) || null;
  if (!first || !last) return { error: "Add your first and last name.", values: keep(formData) };
  if (gender !== "M" && gender !== "F") return { error: "Choose the division you play in.", values: keep(formData) };
  const year = new Date().getFullYear();
  if (!(birthYear > year - 100 && birthYear < year - 4)) return { error: "Enter a birth year between " + (year - 100) + " and " + (year - 5) + ".", values: keep(formData) };
  if (!city || state.length !== 2) return { error: "Add your city and two-letter state.", values: keep(formData) };
  if (!level) return { error: "Pick the level that best describes you.", values: keep(formData) };
  const id = Number(
    getDb()
      .prepare(
        `INSERT INTO players (first_name, last_name, gender, birth_year, city, state, club_id, plays, backhand, seed_rating)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(first, last, gender, birthYear, city, state, clubId, String(formData.get("plays") || "Right"), String(formData.get("backhand") || "Two-handed"), level).lastInsertRowid,
  );
  (await cookies()).set("player_id", String(id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect(`/players/${id}?welcome=1`);
}

export async function recordMatch(_: FormState, formData: FormData): Promise<FormState> {
  const me = await currentPlayer();
  const p1 = Number(formData.get("p1")) || me?.id;
  const p2 = Number(formData.get("p2"));
  const date = String(formData.get("played_on") || "");
  const format = String(formData.get("format") || "best_of_3") as Format;
  const retired = formData.get("retired") === "on";
  const eventId = Number(formData.get("event_id")) || null;
  if (!p1 || !p2) return { error: "Choose both players.", values: keep(formData) };
  if (p1 === p2) return { error: "A player can't play themselves. Pick a different opponent.", values: keep(formData) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Add the date the match was played.", values: keep(formData) };
  if (date > new Date().toISOString().slice(0, 10)) return { error: "The match date can't be in the future.", values: keep(formData) };
  let parsed;
  try {
    parsed = parseScore(String(formData.get("score") || ""));
  } catch (e) {
    return { error: (e as Error).message, values: keep(formData) };
  }
  const winner = winnerOf(parsed.sets) === 1 ? p1 : p2;
  const db = getDb();
  const id = Number(
    db
      .prepare(
        `INSERT INTO matches (event_id, played_on, p1, p2, score, p1_games, p2_games, winner, format, retired, source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(eventId, date, p1, p2, parsed.sets.map(([a, b]) => `${a}-${b}`).join(" "), parsed.p1Games, parsed.p2Games, winner, format, retired ? 1 : 0, "self-reported").lastInsertRowid,
  );
  recomputeAll(db);
  revalidatePath("/", "layout");
  redirect(`/matches/${id}?recorded=1`);
}

export async function registerForEvent(formData: FormData) {
  const me = await currentPlayer();
  const eventId = Number(formData.get("event_id"));
  if (!me) redirect(`/signin?next=/events/${eventId}`);
  const ev = getEvent(eventId);
  if (!ev) redirect("/events");
  getDb().prepare("INSERT OR IGNORE INTO registrations (event_id, player_id) VALUES (?, ?)").run(eventId, me.id);
  revalidatePath(`/events/${eventId}`);
  redirect(`/events/${eventId}?registered=1`);
}

export async function withdrawFromEvent(formData: FormData) {
  const me = await currentPlayer();
  const eventId = Number(formData.get("event_id"));
  if (me) getDb().prepare("DELETE FROM registrations WHERE event_id = ? AND player_id = ?").run(eventId, me.id);
  revalidatePath(`/events/${eventId}`);
  redirect(`/events/${eventId}`);
}
