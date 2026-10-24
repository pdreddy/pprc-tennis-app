import { spawn } from "node:child_process";
import path from "node:path";
import { runtimeEnv } from "./runtime-env.mjs";
const cwd = process.cwd();
const env = runtimeEnv({
  ...process.env,
  FIREBASE_EMULATORS_PATH:
    process.env.FIREBASE_EMULATORS_PATH ||
    path.join(cwd, ".local/firebase/emulators"),
  XDG_CONFIG_HOME:
    process.env.XDG_CONFIG_HOME || path.join(cwd, ".local/config"),
  CI: process.env.CI || "1",
});
const child = spawn(
  process.execPath,
  ["node_modules/firebase-tools/lib/bin/firebase.js", ...process.argv.slice(2)],
  { stdio: "inherit", env },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
