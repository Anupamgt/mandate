import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
    env: { NODE_ENV: "test" },
  },
  resolve: {
    alias: {
      "@mandate/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
    },
  },
});
