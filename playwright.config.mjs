import "./src/runtime.mjs";
import { defineConfig } from "@playwright/test";
const phase = process.env.SCREENS_PROOF_PHASE;
if (phase && !["workflow", "deployment", "restart"].includes(phase))
  throw new Error("Invalid proof phase");
const results = phase ? `test-results/${phase}` : "test-results";
export default defineConfig({
  testDir: "test/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 180000,
  expect: { timeout: 15000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: phase ? `${results}/report` : "playwright-report", open: "never" }],
    ["json", { outputFile: `${results}/e2e-results.json` }],
  ],
  use: {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "on",
    screenshot: "on",
    video: "on",
  },
  outputDir: `${results}/browser`,
});
