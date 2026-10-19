import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.BASELINE_DB ?? path.join(DATA_DIR, "baseline.db");

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS clubs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  courts INTEGER NOT NULL DEFAULT 8,
  surface TEXT NOT NULL DEFAULT 'Hard'
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('M','F')),
  birth_year INTEGER NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  club_id INTEGER REFERENCES clubs(id),
  plays TEXT NOT NULL DEFAULT 'Right',
  backhand TEXT NOT NULL DEFAULT 'Two-handed',
  bio TEXT,
  seed_rating REAL NOT NULL DEFAULT 5,
  rating REAL,
  reliability INTEGER NOT NULL DEFAULT 0,
  match_count INTEGER NOT NULL DEFAULT 0,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  club_id INTEGER REFERENCES clubs(id),
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  min_rating REAL NOT NULL DEFAULT 1,
  max_rating REAL NOT NULL DEFAULT 16.5,
  gender TEXT NOT NULL DEFAULT 'Open',
  entry_fee INTEGER NOT NULL DEFAULT 0,
  draw_size INTEGER NOT NULL DEFAULT 32,
  format TEXT NOT NULL DEFAULT 'best_of_3',
  description TEXT
);
CREATE TABLE IF NOT EXISTS registrations (
  event_id INTEGER NOT NULL REFERENCES events(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, player_id)
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  event_id INTEGER REFERENCES events(id),
  played_on TEXT NOT NULL,
  p1 INTEGER NOT NULL REFERENCES players(id),
  p2 INTEGER NOT NULL REFERENCES players(id),
  score TEXT NOT NULL,
  p1_games INTEGER NOT NULL,
  p2_games INTEGER NOT NULL,
  winner INTEGER NOT NULL,
  format TEXT NOT NULL DEFAULT 'best_of_3',
  retired INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'event',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_matches_p1 ON matches(p1);
CREATE INDEX IF NOT EXISTS idx_matches_p2 ON matches(p2);
CREATE TABLE IF NOT EXISTS match_ratings (
  match_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  match_rating REAL NOT NULL,
  weight REAL NOT NULL,
  PRIMARY KEY (match_id, player_id)
);
CREATE TABLE IF NOT EXISTS rating_history (
  player_id INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  rating REAL NOT NULL,
  PRIMARY KEY (player_id, as_of)
);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  prompt TEXT,
  mock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY,
  player_id INTEGER REFERENCES players(id),
  video_path TEXT NOT NULL,
  notes TEXT,
  result_json TEXT NOT NULL,
  mock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  mock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

declare global {
  // eslint-disable-next-line no-var
  var __baselineDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (globalThis.__baselineDb) return globalThis.__baselineDb;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM players").get() as { n: number }).n;
  if (count === 0) {
    // Lazy import so the seed code isn't loaded on every request.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { seed } = require("./seed") as typeof import("./seed");
    seed(db);
  }
  globalThis.__baselineDb = db;
  return db;
}
