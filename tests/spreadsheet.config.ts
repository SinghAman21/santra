import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "spreadsheet.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:4177",
    channel: process.env.SANTRA_BROWSER_CHANNEL || "chrome",
    viewport: { width: 1100, height: 800 },
  },
  webServer: {
    command: "npm run dev -- --port 4177 --strictPort",
    url: "http://127.0.0.1:4177",
  },
  workers: 1,
});
