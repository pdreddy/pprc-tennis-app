import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "deploy",
  target: "node22",
  splitting: false,
  clean: false,
  noExternal: ["@pprc/shared"],
  external: ["firebase-admin", "firebase-functions", "stripe", "zod"],
  sourcemap: true,
});
