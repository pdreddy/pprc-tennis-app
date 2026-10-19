import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const manifest = readFileSync("deploy/package.json", "utf8");
const hash = createHash("sha256").update(manifest).digest("hex");
if (
  existsSync("deploy/.deps-stamp") &&
  readFileSync("deploy/.deps-stamp", "utf8") === hash &&
  existsSync("deploy/node_modules/firebase-functions/package.json")
)
  process.exit(0);
const modules = existsSync("../node_modules/.modules.yaml")
  ? readFileSync("../node_modules/.modules.yaml", "utf8")
  : "";
const store = modules
  .match(/"?storeDir"?\s*:\s*"?([^"\n,]+)/m)?.[1]
  ?.trim()
  .replace(/['"]/g, "")
  .replace(/\/v\d+$/, "");
const result = spawnSync(
  "pnpm",
  [
    "install",
    "--ignore-workspace",
    "--prefer-offline",
    "--ignore-scripts",
    "--no-frozen-lockfile",
    ...(store ? ["--store-dir", store] : []),
  ],
  { cwd: "deploy", stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync("deploy/.deps-stamp", hash);
