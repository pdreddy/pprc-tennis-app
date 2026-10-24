import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { runtimeEnv } from "./runtime-env.mjs";
const root = process.cwd(),
  local = path.join(root, ".local"),
  stateFile = path.join(local, "runtime.json"),
  stateDir = path.resolve(
    process.env.PPRC_EMULATOR_STATE_DIR || path.join(local, "emulator-state"),
  );
if (!stateDir.startsWith(local + path.sep))
  throw Error("Emulator state must stay inside the ignored .local directory");
mkdirSync(local, { recursive: true });
const env = runtimeEnv({
  ...process.env,
  VITE_USE_EMULATORS: "true",
  VITE_FIREBASE_PROJECT_ID: "demo-pprc-events",
  VITE_EMULATOR_HOST: "127.0.0.1",
});
const tooling = path.join(local, "tooling", "node_modules", ".bin");
env.PATH = tooling + path.delimiter + env.PATH;
const pnpm = "pnpm",
  script = path.join(root, "scripts/events/local.mjs");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, {
    cwd: root,
    env,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(
      `${cmd} ${args.join(" ")} exited ${result.status ?? result.signal}`,
    );
  return result;
};
const probe = (port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
const readState = () => {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return {};
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
function owned(service) {
  if (!service || !alive(service.pid)) return false;
  const check = spawnSync(
    "ps",
    ["-ww", "-p", String(service.pid), "-o", "command="],
    {
      encoding: "utf8",
    },
  );
  return (
    check.status === 0 &&
    check.stdout.includes(script) &&
    check.stdout.includes(service.token)
  );
}
async function assertPortsFree() {
  for (const p of [4000, 4400, 5001, 8080, 9099, 9199, 5173])
    if (await probe(p))
      throw Error(
        `Port ${p} is in use. Stop the existing suite first. ./pprc.sh stop only stops processes managed by this script.`,
      );
}
function prerequisiteCheck() {
  if (Number(process.versions.node.split(".")[0]) !== 22)
    throw Error(
      `Use Node 22; found ${process.version}. On macOS: brew install node@22, then add its bin directory to PATH.`,
    );
  const java = spawnSync("java", ["-version"], { encoding: "utf8" });
  const version = (java.stderr + java.stdout).match(/version "(\d+)/);
  if (java.status !== 0 || !version || Number(version[1]) < 21)
    throw Error(
      "Java 21+ is required. On macOS: brew install --cask temurin@21, then reopen Terminal.",
    );
}
async function setup() {
  prerequisiteCheck();
  const version = spawnSync(pnpm, ["--version"], { env, encoding: "utf8" });
  if (version.status !== 0 || !/^11\./.test(version.stdout.trim())) {
    console.log(
      "Installing project-local pnpm 11.25.0 (no global/sudo installation).",
    );
    run("npm", [
      "install",
      "--prefix",
      path.join(local, "tooling"),
      "--no-package-lock",
      "--ignore-scripts",
      "pnpm@11.25.0",
    ]);
  }
  const cloudCache = existsSync("/workspace/.cache/pnpm");
  const args = ["install", "--frozen-lockfile"];
  if (cloudCache) {
    args.push("--store-dir", "/workspace/.cache/pnpm");
    env.pnpm_config_store_dir = "/workspace/.cache/pnpm";
    env.npm_config_devdir = "/workspace/.cache/node-gyp";
  }
  run(pnpm, args);
  run(pnpm, ["events:build"]);
  if (!existsSync("/usr/bin/chromium"))
    run(pnpm, ["exec", "playwright", "install", "chromium"]);
  console.log("Setup complete. Run ./pprc.sh start, then ./pprc.sh seed.");
}
async function start(options = process.argv.slice(3)) {
  prerequisiteCheck();
  const previous = readState();
  if (owned(previous.emulators) && owned(previous.web)) {
    console.log("PPRC is already running.");
    return;
  }
  if (owned(previous.emulators) || owned(previous.web)) await stop();
  await assertPortsFree();
  const reset = options.includes("--reset"),
    importIndex = options.indexOf("--import"),
    importDir =
      importIndex >= 0
        ? path.resolve(options[importIndex + 1] ?? "")
        : stateDir;
  if (reset && importIndex >= 0)
    throw Error("Choose --reset or --import, not both.");
  if (
    importIndex >= 0 &&
    !existsSync(path.join(importDir, "firebase-export-metadata.json"))
  )
    throw Error("Import requires a Firebase emulator export directory.");
  if (reset) {
    console.log(
      "Explicit --reset: removing only the saved local demo emulator state.",
    );
    rmSync(stateDir, { recursive: true, force: true });
  }
  if (!existsSync("functions/deploy/index.js"))
    run(pnpm, ["--filter", "@pprc/functions", "build"]);
  const state = {
    projectId: "demo-pprc-events",
    startedAt: new Date().toISOString(),
  };
  const launch = (kind) => {
    const token = randomUUID(),
      log = path.join(local, `${kind}.log`),
      fd = openSync(log, "a");
    const child = spawn(
      process.execPath,
      [
        script,
        "_service",
        kind,
        token,
        ...(!reset &&
        existsSync(path.join(importDir, "firebase-export-metadata.json"))
          ? [importDir]
          : []),
      ],
      { cwd: root, env, detached: true, stdio: ["ignore", fd, fd] },
    );
    closeSync(fd);
    child.unref();
    return { pid: child.pid, token, log };
  };
  state.emulators = launch("emulators");
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  try {
    let ready = false;
    for (let n = 0; n < 120; n++) {
      if (!owned(state.emulators))
        throw Error("Emulators exited; inspect .local/emulators.log.");
      try {
        const res = await fetch("http://127.0.0.1:4400/emulators", {
          signal: AbortSignal.timeout(1000),
        });
        const services = await res.json();
        if (
          services.auth &&
          services.firestore &&
          services.functions &&
          services.storage &&
          (await probe(5001))
        ) {
          ready = true;
          break;
        }
      } catch {}
      await pause(1000);
    }
    if (!ready)
      throw Error(
        "Emulator readiness timed out; inspect .local/emulators.log.",
      );
    // A callable must be loaded, not merely a port listening.
    let functionsReady = false;
    for (let n = 0; n < 60; n++) {
      try {
        const r = await fetch(
          "http://127.0.0.1:5001/demo-pprc-events/us-central1/triace",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data: {} }),
            signal: AbortSignal.timeout(1500),
          },
        );
        if (r.status === 401) {
          functionsReady = true;
          break;
        }
      } catch {}
      await pause(500);
    }
    if (!functionsReady)
      throw Error(
        "TRIACE callable did not become ready; inspect .local/emulators.log.",
      );
    state.web = launch("web");
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
    for (let n = 0; n < 60; n++) {
      try {
        const r = await fetch("http://127.0.0.1:5173", {
          signal: AbortSignal.timeout(1000),
        });
        if (r.ok) {
          console.log(
            "PPRC ready: web port 5173; emulator UI port 4000. Run ./pprc.sh seed on a fresh database. Logs: .local/web.log and .local/emulators.log.",
          );
          return;
        }
      } catch {}
      await pause(500);
    }
    throw Error("Web readiness timed out; inspect .local/web.log.");
  } catch (error) {
    await stop();
    throw error;
  }
}
async function stop() {
  const state = readState();
  for (const kind of ["web", "emulators"]) {
    const service = state[kind];
    if (!owned(service)) continue;
    process.kill(service.pid, kind === "emulators" ? "SIGINT" : "SIGTERM");
    for (let i = 0; i < 100 && owned(service); i++) await pause(400);
    if (owned(service))
      throw Error(
        `${kind} did not stop gracefully. Inspect its log; no unrelated processes were killed.`,
      );
  }
  rmSync(stateFile, { force: true });
  console.log(
    "Managed services stopped. Emulator data exports to .local/emulator-state on graceful shutdown.",
  );
}
async function status() {
  const state = readState();
  for (const kind of ["emulators", "web"])
    console.log(
      `${kind}: ${owned(state[kind]) ? "running (managed)" : "stopped/unmanaged"}`,
    );
  console.log(
    `Saved demo state: ${existsSync(path.join(stateDir, "firebase-export-metadata.json")) ? "available" : "none"}`,
  );
}
async function doctor() {
  let bad = false;
  for (const [name, cmd, args] of [
    ["Node", process.execPath, ["--version"]],
    ["pnpm", pnpm, ["--version"]],
    ["Java", "java", ["-version"]],
  ]) {
    const r = spawnSync(cmd, args, { env, encoding: "utf8" });
    console.log(
      `${name}: ${r.status === 0 ? (r.stdout || r.stderr).split("\n")[0] : "missing"}`,
    );
    if (r.status !== 0) bad = true;
  }
  try {
    prerequisiteCheck();
  } catch (e) {
    console.error(e.message);
    bad = true;
  }
  console.log(
    `Dependencies: ${existsSync("node_modules/.modules.yaml") ? "installed" : "run ./pprc.sh setup"}`,
  );
  console.log(
    `Functions: ${existsSync("functions/deploy/index.js") ? "built" : "not built"}`,
  );
  console.log(
    "Tests and seeds target demo-pprc-events on local Firebase emulators only.",
  );
  await status();
  if (bad) process.exitCode = 1;
}
async function tests(kind) {
  const state = readState(),
    restart = owned(state.emulators) || owned(state.web);
  if (restart) await stop();
  await assertPortsFree();
  console.log(
    "Test suites use fresh synthetic demo data without importing your saved development state.",
  );
  try {
    const commands =
      kind === "test-e2e"
        ? ["events:e2e"]
        : kind === "test"
          ? [
              "events:lint",
              "events:typecheck",
              "events:test",
              "events:integration",
            ]
          : [
              "events:lint",
              "events:typecheck",
              "events:test",
              "test",
              "events:build",
              "events:ui",
              "events:pwa",
              "events:persistence",
              "events:e2e",
              "events:integration",
            ];
    for (const command of commands) run(pnpm, [command]);
  } finally {
    if (restart) await start([]);
  }
}
async function service() {
  const kind = process.argv[3],
    args =
      kind === "emulators"
        ? [
            process.execPath,
            [
              "scripts/events/firebase.mjs",
              "emulators:start",
              "--project",
              "demo-pprc-events",
              "--only",
              "auth,firestore,functions,storage",
              "--export-on-exit",
              stateDir,
              ...(process.argv[5] ? ["--import", process.argv[5]] : []),
            ],
          ]
        : [pnpm, ["events:dev"]];
  const child = spawn(args[0], args[1], { cwd: root, env, stdio: "inherit" });
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      if (kind === "web") {
        try {
          process.kill(-process.pid, signal);
        } catch {
          child.kill(signal);
        }
      } else child.kill(signal);
    });
  child.on("exit", (code) => process.exit(code ?? 1));
}
const command = process.argv[2] ?? "help";
try {
  if (command === "_service") await service();
  else if (command === "setup") await setup();
  else if (command === "start") await start();
  else if (command === "stop") await stop();
  else if (command === "status") await status();
  else if (command === "doctor") await doctor();
  else if (command === "seed") {
    if (!(await probe(8080)) || !(await probe(9099)))
      throw Error("Start local demo emulators first: ./pprc.sh start");
    run(pnpm, ["events:seed"]);
  } else if (command === "export") {
    if (!owned(readState().emulators))
      throw Error("Start the managed demo suite first");
    run(process.execPath, [
      "scripts/events/firebase.mjs",
      "emulators:export",
      stateDir,
      "--project",
      "demo-pprc-events",
      "--force",
    ]);
  } else if (["test", "test-e2e", "test-all"].includes(command))
    await tests(command);
  else {
    console.log(
      "Usage: ./pprc.sh setup|start [--reset | --import PATH]|stop|status|seed|test|test-e2e|test-all|doctor|export",
    );
    if (command !== "help") process.exitCode = 1;
  }
} catch (error) {
  console.error(`PPRC: ${error.message}`);
  process.exitCode = 1;
}
