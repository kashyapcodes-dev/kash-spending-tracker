import { defineConfig, devices } from "@playwright/test";
import {
  CLOSED_PORT,
  E2E_DB_URL,
  MAIL_FILE,
  PORT,
  VERIFY_PORT,
} from "./e2e/env";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Generous on purpose: three servers and a shared database make a busy machine slow.
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Runs the production build (turbo's test:e2e depends on build) against a throwaway database.
  webServer: [
    {
      command: "pnpm start",
      url: `http://localhost:${PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: E2E_DB_URL,
        AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-12345",
        APP_URL: `http://localhost:${PORT}`,
        KASH_MAIL_FILE: MAIL_FILE,
        KASH_DISABLE_AUTH_RATE_LIMIT: "1",
        // M5: test key, scripted bank, in-process sync worker.
        APP_ENCRYPTION_KEY: "dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktMTIzNDU=",
        KASH_FAKE_BANK: "true",
        WORKER_MODE: "inline",
        // M7: a scripted model; no real provider is ever called in tests.
        AI_PROVIDER: "fake",
      },
    },
    {
      // Same database, signups closed (M2-E-1).
      command: `pnpm exec next start --port ${CLOSED_PORT}`,
      url: `http://localhost:${CLOSED_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: E2E_DB_URL,
        AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-12345",
        APP_URL: `http://localhost:${CLOSED_PORT}`,
        SIGNUP_MODE: "closed",
      },
    },
    {
      // Same database, email verification required (M9-E-2). Mail goes to the shared mail file.
      command: `pnpm exec next start --port ${VERIFY_PORT}`,
      url: `http://localhost:${VERIFY_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: E2E_DB_URL,
        AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-12345",
        APP_URL: `http://localhost:${VERIFY_PORT}`,
        KASH_MAIL_FILE: MAIL_FILE,
        KASH_DISABLE_AUTH_RATE_LIMIT: "1",
        REQUIRE_EMAIL_VERIFICATION: "true",
      },
    },
  ],
});
