import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    include: ["lib/**/*.test.ts", "components/**/*.test.tsx", "app/**/*.test.{ts,tsx}"],
    environment: "node",
    // `server-only` throws outside a React Server environment; tests import server modules directly.
    alias: { "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname },
  },
});
