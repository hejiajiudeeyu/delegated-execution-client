import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import base from "./vitest.base.config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const opsConsoleSrc = path.resolve(here, "../../apps/ops-console/src");

export default mergeConfig(
  base,
  defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        "@": opsConsoleSrc
      }
    },
    test: {
      include: ["tests/unit/**/*.test.{js,tsx}"]
    }
  })
);
