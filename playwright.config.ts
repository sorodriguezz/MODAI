// Panel UI tests: `npm run test:ui`. They start a real server on a throwaway database and drive
// the compiled panel in Chromium. Run `npx playwright install chromium` once beforehand.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.MODAI_UI_PORT ?? 8798);
const data = mkdtempSync(join(tmpdir(), "modai-ui-"));
export const UI = {
  url: `http://127.0.0.1:${port}`,
  token: "ui-test-token",
  username: "admin",
  password: "ui-test-password-123",
};

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: UI.url, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: "node --no-warnings apps/server/dist/main.js",
    url: `${UI.url}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      MODAI_PORT: String(port),
      MODAI_HOST: "127.0.0.1",
      MODAI_API_TOKEN: UI.token,
      MODAI_ADMIN_USERNAME: UI.username,
      MODAI_ADMIN_PASSWORD: UI.password,
      MODAI_LOGIN_RATE_LIMIT: "1000",
      MODAI_DATABASE_PATH: join(data, "modai.db"),
      MODAI_ARTIFACT_DIR: join(data, "artifacts"),
    },
  },
});
