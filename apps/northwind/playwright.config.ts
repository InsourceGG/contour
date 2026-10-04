import { defineConfig, devices } from "@playwright/test";

/**
 * Signed-in end-to-end checks against a running Northwind (`pnpm dev`, port 3200)
 * and its real database. Never part of `pnpm test` (vitest only collects
 * tests/**\/*.test.ts). Run explicitly:
 *
 *   NORTHWIND_E2E=1 pnpm -F northwind test:e2e
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.NORTHWIND_E2E_URL ?? "http://localhost:3200", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
});
