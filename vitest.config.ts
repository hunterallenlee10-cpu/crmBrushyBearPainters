import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    include: [
      "lib/**/*.test.ts",
      "components/**/*.test.tsx",
      "app/**/*.test.{ts,tsx}",
      "tests/e2e/support/**/*.test.ts",
    ],
    environment: "node",
    // `server-only` throws outside a React Server environment; tests import server modules directly.
    alias: { "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname },
    // `pnpm test:coverage`: the pricing engine must stay fully covered (PLAN Phase 4).
    coverage: {
      provider: "v8",
      include: ["lib/domain/estimating/**/*.ts"],
      exclude: ["lib/domain/estimating/**/*.test.ts", "lib/domain/estimating/fixtures.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
