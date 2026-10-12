import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: ["appstore-screenshots.spec.ts", "appstore-ios-screenshots.spec.ts"],
  timeout: 60000,
  use: {
    baseURL: "http://localhost:1421",
  },
  webServer: {
    command: "npx vite --config vite.screenshot.config.ts",
    port: 1421,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
