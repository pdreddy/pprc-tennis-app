import type Database from "better-sqlite3";
import { expectedShare, Format } from "./rating";
import { recomputeAll } from "./ratings-service";

/**
 * Seeds a fictional player pool. Every name, club and event here is invented.
 * Matches are simulated from a hidden "true level" so ratings behave realistically.
 */

let state = 20261019;
const rand = () => ((state = (state * 48271) % 2147483647) / 2147483647);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const gauss = () => {
  const u = rand() || 1e-9;
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const FIRST_M = ["Mateo","Ethan","Noah","Lucas","Aarav","Owen","Diego","Caleb","Julian","Ravi","Marcus","Theo","Isaac","Andre","Kai","Felix","Jonah","Arjun","Miles","Tomas","Bennett","Elias","Hugo","Rohan","Silas","Adrian","Wes","Nico","Grant","Malik"];
const FIRST_F = ["Ava","Sofia","Maya","Chloe","Priya","Elena","Harper","Leah","Nora","Isla","Camila","Zoe","Ananya","Grace","Lucia","Mila","Tessa","Jade","Aria","Naomi","Ruby","Clara","Ivy","Sana","Paige","Vera","Leila","Quinn","Hana","Daria"];
const LAST = ["Alvarez","Bennett","Chen","Dorsey","Ellison","Fuentes","Garza","Hollis","Iyer","Jansen","Kowalski","Lindqvist","Morales","Nakamura","Okafor","Patel","Quintero","Ramos","Sato","Thornton","Underwood","Vasquez","Whitaker","Xu","Yilmaz","Zamora","Brennan","Castillo","Delgado","Fischer","Greer","Hart","Kapoor","Lowell","Mercer","Novak","Ortiz","Pryor","Reyes","Sutton"];

const CLUBS = [
  { name: "Cedar Ridge Tennis Center", city: "Frisco", state: "TX", courts: 16, surface: "Hard" },
  { name: "Lakeside Racquet Club", city: "Plano", state: "TX", courts: 12, surface: "Hard" },
  { name: "Northgate Tennis Academy", city: "McKinney", state: "TX", courts: 10, surface: "Hard" },
  { name: "Bluebonnet Courts", city: "Austin", state: "TX", courts: 14, surface: "Hard" },
  { name: "Riverbend Athletic Club", city: "Houston", state: "TX", courts: 18, surface: "Clay" },
  { name: "Mesa Verde Tennis Club", city: "San Antonio", state: "TX", courts: 8, surface: "Hard" },
  { name: "Red Dirt Racquet Club", city: "Oklahoma City", state: "OK", courts: 10, surface: "Hard" },
];

function simulateSet(pA: number): [number, number] {
  let a = 0;
  let b = 0;
  while (true) {
    if (rand() < pA) a++;
    else b++;
    if ((a >= 6 || b >= 6) && Math.abs(a - b) >= 2) return [a, b];
    if (a === 6 && b === 6) return rand() < pA ? [7, 6] : [6, 7];
  }
}

function simulateMatch(levelA: number, levelB: number, format: Format): { sets: [number, number][]; winner: 1 | 2 } {
  // Per-game probability; a little day-to-day form noise.
  const pA = expectedShare(levelA - levelB + gauss() * 0.35);
  const sets: [number, number][] = [];
  if (format === "one_set") {
    const s = simulateSet(pA);
    return { sets: [s], winner: s[0] > s[1] ? 1 : 2 };
  }
  if (format === "pro_set") {
    let a = 0, b = 0;
    while (!((a >= 8 || b >= 8) && Math.abs(a - b) >= 2) && !(a === 9 || b === 9)) rand() < pA ? a++ : b++;
    return { sets: [[a, b]], winner: a > b ? 1 : 2 };
  }
  let wa = 0, wb = 0;
  const need = format === "best_of_5" ? 3 : 2;
  while (wa < need && wb < need) {
    if (wa === 1 && wb === 1 && format === "best_of_3" && rand() < 0.5) {
      // Match tiebreak to 10.
      let a = 0, b = 0;
      while (!((a >= 10 || b >= 10) && Math.abs(a - b) >= 2)) rand() < pA ? a++ : b++;
      sets.push([a, b]);
      a > b ? wa++ : wb++;
      break;
    }
    const s = simulateSet(pA);
    sets.push(s);
    s[0] > s[1] ? wa++ : wb++;
  }
  return { sets, winner: wa > wb ? 1 : 2 };
}

const fmt = (sets: [number, number][]) => sets.map(([a, b]) => `${a}-${b}`).join(" ");

function gamesOf(sets: [number, number][]) {
  let a = 0, b = 0;
  sets.forEach(([x, y], i) => {
    if (i === sets.length - 1 && sets.length >= 3 && Math.max(x, y) >= 10) x > y ? a++ : b++;
    else { a += x; b += y; }
  });
  return [a, b];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export function seed(db: Database.Database, today = new Date()) {
  state = 20261019;
  const tx = db.transaction(() => {
    const clubIns = db.prepare("INSERT INTO clubs (name, city, state, courts, surface) VALUES (?,?,?,?,?)");
    const clubIds = CLUBS.map((c) => Number(clubIns.run(c.name, c.city, c.state, c.courts, c.surface).lastInsertRowid));

    const playerIns = db.prepare(
      `INSERT INTO players (first_name, last_name, gender, birth_year, city, state, club_id, plays, backhand, bio, seed_rating)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const level = new Map<number, number>();
    const used = new Set<string>();
    for (let i = 0; i < 160; i++) {
      const gender = rand() < 0.5 ? "M" : "F";
      let first = "", last = "";
      do {
        first = pick(gender === "M" ? FIRST_M : FIRST_F);
        last = pick(LAST);
      } while (used.has(first + last));
      used.add(first + last);
      const junior = rand() < 0.55;
      const birthYear = junior ? 2008 + Math.floor(rand() * 9) : 1965 + Math.floor(rand() * 40);
      const age = today.getFullYear() - birthYear;
      let lvl = junior ? 1.5 + (age - 9) * 0.75 + gauss() * 1.6 : 6 + gauss() * 2.2;
      if (!junior && rand() < 0.08) lvl = 11.5 + rand() * 2.5; // a few college / ex-college players
      if (gender === "M") lvl += 0.6;
      lvl = Math.max(1.5, Math.min(14.5, lvl));
      const clubIdx = Math.floor(rand() * clubIds.length);
      const club = CLUBS[clubIdx];
      const plays = rand() < 0.86 ? "Right" : "Left";
      const backhand = rand() < (junior ? 0.85 : 0.6) ? "Two-handed" : "One-handed";
      const bio = junior
        ? `Junior player training at ${club.name}.`
        : pick(["League regular and weekend tournament player.", "Former college player, still competing.", "Plays mostly flex league and club events.", "Came back to tennis after a long break."]);
      const reported = Math.round((lvl + gauss() * 0.9) * 2) / 2;
      const id = Number(
        playerIns.run(first, last, gender, birthYear, club.city, club.state, clubIds[clubIdx], plays, backhand, bio, Math.max(1, reported)).lastInsertRowid,
      );
      level.set(id, lvl);
    }
    const ids = [...level.keys()];
    const genderOf = new Map((db.prepare("SELECT id, gender FROM players").all() as { id: number; gender: string }[]).map((p) => [p.id, p.gender]));

    const eventIns = db.prepare(
      `INSERT INTO events (name, club_id, city, state, start_date, end_date, min_rating, max_rating, gender, entry_fee, draw_size, format, description)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const matchIns = db.prepare(
      `INSERT INTO matches (event_id, played_on, p1, p2, score, p1_games, p2_games, winner, format, retired, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const regIns = db.prepare("INSERT OR IGNORE INTO registrations (event_id, player_id) VALUES (?,?)");

    const EVENT_NAMES = ["Fall Classic", "Winter Open", "Spring Shootout", "Summer Slam", "Harvest Cup", "Night Owl Series", "Bracket Challenge", "Club Championships", "Rising Stars", "Level-Based Play Day"];
    const bands: [number, number, string][] = [[1, 5, "Level 1–5"], [4, 8, "Level 4–8"], [7, 11, "Level 7–11"], [10, 16.5, "Level 10+"], [1, 16.5, "Open"]];

    // Past events with full single-elimination draws.
    for (let e = 0; e < 18; e++) {
      const start = addDays(today, -Math.floor(10 + rand() * 340));
      const clubIdx = Math.floor(rand() * clubIds.length);
      const [lo, hi, bandName] = pick(bands);
      const g = pick(["M", "F", "Open"]);
      const name = `${CLUBS[clubIdx].name.split(" ")[0]} ${pick(EVENT_NAMES)} ${bandName}`;
      const eventId = Number(
        eventIns.run(name, clubIds[clubIdx], CLUBS[clubIdx].city, CLUBS[clubIdx].state, iso(start), iso(addDays(start, 2)), lo, hi,
          g === "Open" ? "Open" : g === "M" ? "Men" : "Women", 35 + Math.floor(rand() * 5) * 10, 16, "best_of_3",
          "Level-based singles draw. Every match counts towards your rating.").lastInsertRowid,
      );
      let field = ids.filter((p) => level.get(p)! >= lo - 0.5 && level.get(p)! <= hi + 0.5 && (g === "Open" || genderOf.get(p) === g));
      field = field.sort(() => rand() - 0.5).slice(0, 16);
      if (field.length < 4) continue;
      const size = field.length >= 16 ? 16 : field.length >= 8 ? 8 : 4;
      let round = field.slice(0, size);
      round.forEach((p) => regIns.run(eventId, p));
      let day = 0;
      while (round.length > 1) {
        const next: number[] = [];
        for (let i = 0; i < round.length; i += 2) {
          const a = round[i], b = round[i + 1];
          const { sets, winner } = simulateMatch(level.get(a)!, level.get(b)!, "best_of_3");
          const [ga, gb] = gamesOf(sets);
          matchIns.run(eventId, iso(addDays(start, Math.min(2, day))), a, b, fmt(sets), ga, gb, winner === 1 ? a : b, "best_of_3", 0, "event");
          next.push(winner === 1 ? a : b);
        }
        round = next;
        day++;
      }
    }

    // League and practice-match results reported by players.
    for (let k = 0; k < 900; k++) {
      const a = pick(ids);
      const candidates = ids.filter((p) => p !== a && Math.abs(level.get(p)! - level.get(a)!) < 2.5);
      if (candidates.length === 0) continue;
      const b = pick(candidates);
      const format: Format = rand() < 0.75 ? "best_of_3" : rand() < 0.5 ? "pro_set" : "one_set";
      const { sets, winner } = simulateMatch(level.get(a)!, level.get(b)!, format);
      const [ga, gb] = gamesOf(sets);
      const played = addDays(today, -Math.floor(rand() * 360));
      matchIns.run(null, iso(played), a, b, fmt(sets), ga, gb, winner === 1 ? a : b, format, 0, rand() < 0.6 ? "league" : "self-reported");
    }

    // Upcoming events open for registration.
    for (let e = 0; e < 8; e++) {
      const start = addDays(today, 5 + Math.floor(rand() * 75));
      const clubIdx = e % clubIds.length;
      const [lo, hi, bandName] = bands[e % bands.length];
      const g = pick(["Men", "Women", "Open"]);
      const eventId = Number(
        eventIns.run(`${CLUBS[clubIdx].name.split(" ")[0]} ${pick(EVENT_NAMES)} ${bandName}`, clubIds[clubIdx], CLUBS[clubIdx].city, CLUBS[clubIdx].state,
          iso(start), iso(addDays(start, 1 + Math.floor(rand() * 2))), lo, hi, g, 30 + Math.floor(rand() * 6) * 10,
          pick([16, 32]), pick(["best_of_3", "pro_set"]), "Level-based singles. Players are placed into draws by rating so every match is competitive.").lastInsertRowid,
      );
      const eligible = ids.filter((p) => level.get(p)! >= lo && level.get(p)! <= hi && (g === "Open" || genderOf.get(p) === (g === "Men" ? "M" : "F")));
      eligible.sort(() => rand() - 0.5).slice(0, 3 + Math.floor(rand() * 9)).forEach((p) => regIns.run(eventId, p));
    }
  });
  tx();
  recomputeAll(db, today);
}
