import fs from "node:fs";
import path from "node:path";
import { getDb } from "../lib/db";

const dbPath = process.env.BASELINE_DB ?? path.join(process.cwd(), "data", "baseline.db");
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
const t = Date.now();
const db = getDb();
const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
console.log(
  `Seeded ${n("SELECT COUNT(*) n FROM players")} players, ${n("SELECT COUNT(*) n FROM matches")} matches, ` +
    `${n("SELECT COUNT(*) n FROM events")} events in ${Date.now() - t}ms`,
);
