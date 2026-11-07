import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import sharp from "sharp";
import { Store } from "../../src/store.mjs";
import { makeServer } from "../../src/server.mjs";

test("review sets preserve order and selected areas remain bound to their capture", async ({ page }, info) => {
  const dir = mkdtempSync(join(tmpdir(), "screens-review-areas-"));
  const store = new Store(dir);
  const server = makeServer(store);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    store.project({ id: "areas", name: "Area review" });
    const white = await sharp({ create: { width: 200, height: 160, channels: 3, background: "white" } }).png().toBuffer();
    const patch = await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } }).png().toBuffer();
    const changed = await sharp(white).composite([{ input: patch, left: 80, top: 64 }]).png().toBuffer();
    const captures = [];
    for (const [key, title] of [["home", "Home"], ["checkout", "Checkout"]]) {
      store.screen({ project: "areas", key, title });
      for (const role of ["current", "target"]) captures.push(store.capture({
        screen: `areas/${key}`, role, bytes: role === "current" ? white : changed,
        fixture: "review-area-fixture", revision: "fixture", variant: { viewport: "200x160" },
      }));
    }
    const run = store.run({ project: "areas", title: "Area review", captureIds: captures.map((capture) => capture.id) });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/?project=areas&run=${run.id}`);
    await expect(page.locator("#title")).toHaveText("Home");
    await page.getByRole("button", { name: "New set", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Checkout flow");
    const entries = store.compare(run.id).entries;
    const key = (title) => {
      const entry = entries.find((item) => item.title === title);
      return `${entry.screen}|${JSON.stringify(entry.variant)}`;
    };
    await dialog.getByLabel("Add a screen").selectOption(key("Home"));
    await dialog.getByLabel("Add a screen").selectOption(key("Checkout"));
    await dialog.getByRole("button", { name: /^Move Checkout .* earlier$/ }).click();
    await dialog.getByRole("button", { name: "Save set", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("#title")).toHaveText("Checkout");
    const saved = store.reviewSets(run.id)[0];
    expect(saved.entries).toEqual([key("Checkout"), key("Home")]);
    await expect(page).toHaveURL(new RegExp(`set=${saved.id}`));
    await page.getByRole("button", { name: "Next screen", exact: true }).click();
    await expect(page.locator("#title")).toHaveText("Home");
    await page.reload();
    await expect(page.locator("#title")).toHaveText("Home");
    await expect(page.getByLabel("Review set", { exact: true })).toHaveValue(saved.id);
    await page.getByRole("button", { name: "Select area", exact: true }).click();
    const surface = page.getByRole("button", { name: /^Select an area to compare or comment/ }).first();
    await surface.focus();
    await surface.press("Enter");
    await surface.press("ArrowRight");
    await surface.press("Shift+ArrowRight");
    await surface.press("Enter");
    await page.getByRole("button", { name: "Compare selected area", exact: true }).click();
    await expect(page.getByRole("region", { name: "Selected area comparison" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Current, selected area", exact: true })).toHaveAttribute("viewBox", "52 40 102 80");
    await page.getByRole("button", { name: /Inspect pixel differences/ }).click();
    await page.getByRole("button", { name: "Measure selected area", exact: true }).click();
    await expect(page.locator("#diff-result")).toContainText("400 / 8,160 compared pixels");
    const measurement = store.compare(run.id).entries.find((entry) => entry.title === "Home").measurements[0];
    expect(measurement.region).toEqual({ x: 0.26, y: 0.25, width: 0.51, height: 0.5 });
    expect(measurement.regionPixels).toEqual({ x: 52, y: 40, width: 102, height: 80 });
    await page.getByRole("button", { name: "Comment on area", exact: true }).click();
    await page.getByLabel("What should change?", { exact: true }).fill("Align the highlighted area with the design");
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(page.locator("#notes")).toContainText("Align the highlighted area");
    const note = store.getScreen("areas/home").notes[0];
    expect(note.capture).toBe(captures.find((capture) => capture.screen === "areas/home" && capture.role === "current").id);
    expect(note.region).toEqual(measurement.region);
    await page.reload();
    await expect(page.locator("#title")).toHaveText("Home");
    await page.getByLabel("Select an annotated area").selectOption(note.id);
    await page.getByRole("button", { name: "Compare selected area", exact: true }).click();
    await expect(page.getByRole("img", { name: "Current, selected area", exact: true })).toHaveAttribute("viewBox", "52 40 102 80");
    await page.getByRole("button", { name: "Show full screenshots", exact: true }).click();
    await page.getByRole("button", { name: "Select area", exact: true }).click();
    const bounds = await surface.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * 0.1, bounds.y + bounds.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.6, { steps: 5 });
    await page.mouse.up();
    await page.getByRole("button", { name: "Comment on area", exact: true }).click();
    await page.getByLabel("What should change?", { exact: true }).fill("Pointer area comment");
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(page.locator("#notes")).toContainText("Pointer area comment");
    const pointerNote = store.getScreen("areas/home").notes.find((item) => item.text === "Pointer area comment");
    expect(pointerNote.region.x).toBeCloseTo(0.1, 2);
    expect(pointerNote.region.width).toBeCloseTo(0.5, 2);
    expect(pointerNote.region.height).toBeCloseTo(0.4, 2);
    await page.screenshot({ path: info.outputPath("review-set-area-comments.png"), fullPage: true });
    await page.getByRole("button", { name: "Edit set", exact: true }).click();
    await dialog.getByLabel("Name", { exact: true }).fill("Changed locally");
    const concurrent = await page.request.post(`${base}/api/review-sets`, { data: {
      id: saved.id, run: run.id, title: "Updated elsewhere", entries: saved.entries, expectedRevision: saved.revision,
    } });
    expect(concurrent.ok()).toBe(true);
    await dialog.getByRole("button", { name: "Save set", exact: true }).click();
    await expect(dialog).toContainText("Review set changed. Reload before saving.");
    expect(store.reviewSets(run.id)[0].title).toBe("Updated elsewhere");
    expect(errors).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
