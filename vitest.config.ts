import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
    env: { NODE_ENV: "test" },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@mandate/shared": `${root}/packages/shared/src/index.ts`,
      "@mandate/policy": `${root}/packages/policy/src/index.ts`,
      "@mandate/mandate": `${root}/packages/mandate/src/index.ts`,
      "@mandate/audit": `${root}/packages/audit/src/index.ts`,
      "@mandate/rails": `${root}/packages/rails/src/index.ts`,
      "@mandate/db": `${root}/packages/db/src/index.ts`,
    },
  },
});
