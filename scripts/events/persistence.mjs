import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
const stateDir = path.resolve(`.local/persistence-test-${crypto.randomUUID()}`);
if (existsSync(".local/runtime.json"))
  throw Error(
    "Stop managed development services first. This test will not reuse development data.",
  );
if (existsSync(`${stateDir}/firebase-export-metadata.json`))
  throw Error(
    "Persistence test requires a fresh isolated local state directory. Preserve/move your development export first; this test will not erase it.",
  );
const run = (...args) => {
  const r = spawnSync("./pprc.sh", args, {
    stdio: "inherit",
    env: { ...process.env, PPRC_EMULATOR_STATE_DIR: stateDir },
  });
  if (r.status !== 0) throw Error(`pprc ${args.join(" ")} failed`);
};
const signIn = async () => {
  const r = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-pprc-events",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({
        email: "player1@pprc.test",
        password: "PprcDemo2026!",
        returnSecureToken: true,
      }),
    },
  );
  const j = await r.json();
  if (!r.ok) throw Error("Synthetic emulator Auth login failed");
  return j.idToken;
};
const readTeam = async (id, token) => {
  const r = await fetch(
    `http://127.0.0.1:8080/v1/projects/demo-pprc-events/databases/(default)/documents/teams/${id}`,
    { headers: { Authorization: `Bearer ${token}`, Connection: "close" } },
  );
  if (!r.ok) throw Error(`Persisted private team read failed: ${r.status}`);
  return r.json();
};
try {
  run("start");
  run("seed");
  const token = await signIn();
  const r = await fetch(
    "http://127.0.0.1:5001/demo-pprc-events/us-central1/triace",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Connection: "close",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        data: {
          requestId: crypto.randomUUID(),
          eventId: "triace-cup",
          action: "createTeam",
          name: "Persistence Rehearsal",
          waiver: true,
        },
      }),
    },
  );
  const result = await r.json();
  if (!r.ok)
    throw Error(result.error?.message ?? "Synthetic team creation failed");
  const id = result.result.teamId,
    before = await readTeam(id, token);
  run("export");
  run("stop");
  const metadata = JSON.parse(
    readFileSync(`${stateDir}/firebase-export-metadata.json`, "utf8"),
  );
  if (!metadata.firestore || !metadata.auth)
    throw Error("Export lacks Firestore or Auth state");
  run("start", "--import", stateDir);
  const after = await readTeam(id, await signIn());
  if (
    after.fields.name.stringValue !== before.fields.name.stringValue ||
    after.fields.captainId.stringValue !== "player1"
  )
    throw Error("Restored private team differs");
  console.log(
    "PASS: real callable team write, Firestore/Auth export, graceful stop, import, re-authentication and private roster restoration.",
  );
} finally {
  run("stop");
}
