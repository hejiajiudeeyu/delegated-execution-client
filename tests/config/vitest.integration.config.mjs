import path from "node:path";
import { existsSync } from "node:fs";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.base.config.mjs";

// Resolve platform-api source for integration tests.
// Works in both CI (sibling checkout) and fourth-repo monorepo (repos/platform).
function resolvePlatformDir() {
  const candidates = [
    path.resolve(process.cwd(), "../platform"),
    path.resolve(process.cwd(), "../../platform"),
    path.resolve(process.cwd(), "../../repos/platform"),
  ];
  for (const p of candidates) {
    if (existsSync(path.join(p, "package.json"))) return p;
  }
  return candidates[0];
}

const platformApiEntry = path.join(resolvePlatformDir(), "apps/platform-api/src/server.js");

export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: {
        "@delexec/platform-api": platformApiEntry,
      }
    },
    test: {
      include: ["tests/integration/**/*.test.js"],
      fileParallelism: false,
      maxWorkers: 1,
      minWorkers: 1
    }
  })
);
