import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// Keep child tools on the store that owns this install, including restricted clouds.
export function runtimeEnv(existing = process.env, root = process.cwd()) {
  const env = { ...existing },
    metadata = path.join(root, "node_modules/.modules.yaml");
  if (
    !env.pnpm_config_store_dir &&
    !env.PNPM_CONFIG_STORE_DIR &&
    existsSync(metadata)
  ) {
    const store = readFileSync(metadata, "utf8")
      .match(/"?storeDir"?\s*:\s*"?([^"\n,]+)/m)?.[1]
      ?.trim()
      .replace(/['"]/g, "")
      .replace(/\/v\d+$/, "");
    if (store) env.pnpm_config_store_dir = store;
  }
  return env;
}
