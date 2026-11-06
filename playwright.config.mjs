import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "test/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 180000,
  expect: { timeout: 15000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/e2e-results.json" }],
  ],
  use: {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "on",
    screenshot: "on",
    video: "on",
  },
  outputDir: "test-results/browser",
});
