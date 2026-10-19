import { mkdirSync, readdirSync, lstatSync, unlinkSync } from "node:fs";
mkdirSync("deploy", { recursive: true });
// Remove only generated files, never traverse local dependency links.
for (const name of readdirSync("deploy")) {
  const path = `deploy/${name}`,
    stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    unlinkSync(path);
    continue;
  }
  if (
    stat.isFile() &&
    (["index.js", "index.js.map", "package.json"].includes(name) ||
      name.startsWith(".env"))
  )
    unlinkSync(path);
}
