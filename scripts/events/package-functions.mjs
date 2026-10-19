import {
  copyFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
const source = JSON.parse(readFileSync("package.json", "utf8"));
const dependencies = Object.fromEntries(
  Object.entries(source.dependencies)
    .filter(([name]) => !name.startsWith("@pprc/"))
    .map(([name]) => [
      name,
      JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8"))
        .version,
    ]),
);
writeFileSync(
  "deploy/package.json",
  JSON.stringify(
    {
      name: "pprc-events-functions",
      private: true,
      type: "module",
      main: "index.js",
      engines: { node: "22" },
      dependencies,
    },
    null,
    2,
  ) + "\n",
);
for (const file of readdirSync(".")) {
  if (/^\.env(?:\.|$)/.test(file) && file !== ".env.example")
    copyFileSync(file, `deploy/${file}`);
}
