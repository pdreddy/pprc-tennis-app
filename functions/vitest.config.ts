import { defineConfig } from "vitest/config";
// These files share a real emulator project and install its security rules.
// Serialize files so rule reloads and fixture writes cannot race other suites.
export default defineConfig({ test: { fileParallelism: false } });
