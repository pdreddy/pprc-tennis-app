import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
const args = process.argv.slice(2),
  command = args[0] ?? "check",
  project = JSON.parse(readFileSync(".firebaserc", "utf8")).projects.staging;
if (!project || project.startsWith("demo-"))
  throw Error("Configure a separate non-demo staging alias in .firebaserc");
const run = (cmd, argv, options = {}) => {
  const r = spawnSync(cmd, argv, {
    stdio: "inherit",
    env: process.env,
    ...options,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw Error(`${cmd} exited ${r.status}`);
};
const approved = () => {
  if (
    !args.includes("--approve-staging") ||
    process.env.PPRC_ALLOW_STAGING_WRITE !== project
  )
    throw Error(
      `No staging mutation performed. Explicit approval requires --approve-staging and PPRC_ALLOW_STAGING_WRITE=${project}.`,
    );
  if (
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw Error("Unset emulator bindings before staging deployment");
};
const getConfig = () => {
  const webFile = "apps/web/.env.production.local",
    functionsFile = `functions/.env.${project}`;
  const web = existsSync(webFile)
      ? parseEnv(readFileSync(webFile, "utf8"))
      : {},
    server = existsSync(functionsFile)
      ? parseEnv(readFileSync(functionsFile, "utf8"))
      : {};
  const required = [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_APP_ID",
  ];
  const missing = required.filter((k) => !web[k] || web[k].includes("YOUR_"));
  if (web.VITE_FIREBASE_PROJECT_ID !== project)
    missing.push("VITE_FIREBASE_PROJECT_ID must match staging");
  if (web.VITE_USE_EMULATORS !== "false")
    missing.push("VITE_USE_EMULATORS=false");
  if (!server.APP_ORIGIN?.startsWith("https://"))
    missing.push("HTTPS APP_ORIGIN in server env file");
  for (const [k, v] of Object.entries(web))
    if (
      /SECRET|PRIVATE|PASSWORD|SERVICE_ACCOUNT|STRIPE/.test(k) ||
      /^(sk|rk)_live_|-----BEGIN .*PRIVATE KEY/.test(v)
    )
      throw Error(
        `Privileged value or key name found in frontend config: ${k}`,
      );
  return { web, server, missing };
};
try {
  if (command === "check") {
    const c = getConfig();
    console.log(
      `Staging target: ${project}. Firestore, not Realtime Database. No deployment or database write performed.`,
    );
    if (c.missing.length) {
      console.log(
        "Missing configuration:\n" + c.missing.map((k) => "- " + k).join("\n"),
      );
      process.exitCode = 1;
    } else
      console.log(
        "Public client config and server origin present. Auth, IAM, secrets, billing and staging isolation still require verification.",
      );
  } else if (command === "deploy") {
    approved();
    const c = getConfig();
    if (c.missing.length)
      throw Error(
        "Run events:staging check and supply missing configuration first",
      );
    run("pnpm", ["events:build"]);
    run("pnpm", [
      "exec",
      "firebase",
      "deploy",
      "--project",
      project,
      "--only",
      "firestore,storage,functions,hosting",
    ]);
  } else if (command === "bootstrap" || command === "fixtures") {
    approved();
    const uid = args[args.indexOf("--uid") + 1];
    if (!args.includes("--uid") || !/^[\w-]{1,128}$/.test(uid))
      throw Error("Pass the trusted staging admin Firebase UID via --uid");
    run("pnpm", [
      "--filter",
      "@pprc/functions",
      "exec",
      "tsx",
      "src/staging-data.ts",
      command,
      "--project",
      project,
      "--uid",
      uid,
      "--approve-staging",
    ]);
  } else if (command === "smoke") {
    const c = getConfig();
    if (c.missing.length)
      throw Error("Staging client configuration is incomplete");
    const origin = c.server.APP_ORIGIN;
    for (const suffix of [
      "/",
      "/manifest.webmanifest",
      "/sw.js",
      "/icon-192.png",
      "/events",
      "/teams",
    ]) {
      const r = await fetch(origin + suffix, {
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok)
        throw Error(`Staging smoke failed ${suffix}: HTTP ${r.status}`);
      console.log(`HTTP ${r.status}: ${suffix}`);
    }
    console.log(
      "Hosting smoke only. Run the staging role/payment/push checks in docs/STAGING.md; this does not claim backend or payment readiness.",
    );
  } else if (command === "backup") {
    approved();
    const bucket = args[args.indexOf("--bucket") + 1];
    if (
      !args.includes("--bucket") ||
      !/^gs:\/\/[a-z0-9._-]+\/[\w/-]+$/.test(bucket)
    )
      throw Error("Use --bucket gs://STAGING_BACKUP_BUCKET/exports/PREFIX");
    run("gcloud", ["firestore", "export", bucket, "--project", project]);
  } else
    throw Error(
      "Usage: events:staging check|deploy|bootstrap --uid UID|fixtures --uid UID|smoke|backup --bucket gs://bucket/prefix. Mutations require explicit approval.",
    );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
