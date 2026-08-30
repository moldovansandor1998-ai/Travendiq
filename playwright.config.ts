import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E – desktop + mobil projekt.
 * A webServer a production buildet szolgálja ki (npm run build && npm run start).
 * Élő Supabase/Stripe nélkül az UI-smoke tesztek futnak; az adatbázist igénylő
 * folyamatok a flows.spec.ts-ben E2E_DB_URL megadásával aktiválódnak.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // iPhone 13 viewport/chrome, de chromium motorral (a CI-ba csak chromium kerül)
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start -- -p 3100",
        url: "http://127.0.0.1:3100/en",
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon",
        },
      },
});
