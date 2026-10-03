import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["tests/support/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    fileParallelism: false,
  },
});
