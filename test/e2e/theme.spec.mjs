import { test, expect } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import sharp from "sharp";
import { Store } from "../../src/store.mjs";
import { makeServer } from "../../src/server.mjs";

test("Verdictan colors render on desktop and mobile with working focus and hover states", async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "screens-theme-")),
    store = new Store(dir),
    server = makeServer(store);
  try {
    store.project({ id: "theme", name: "Theme" });
    store.screen({ project: "theme", key: "home", title: "Home" });
    const bytes = await sharp({
      create: { width: 200, height: 200, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const captures = ["current", "target", "pr"].map((role) =>
      store.capture({ screen: "theme/home", role, bytes, fixture: "theme" }),
    );
    store.run({
      project: "theme",
      title: "Theme review",
      captureIds: captures.map((c) => c.id),
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.locator("#title")).toHaveText("Home");
    const palette = {
      "--background": "#f8f7f5",
      "--foreground": "#1f1b17",
      "--card": "#fffdf9",
      "--primary": "#9a4600",
      "--sidebar": "#f3eee8",
      "--sidebar-hover": "#ebe2d9",
      "--sidebar-active": "#e4d6c8",
    };
    for (const [token, color] of Object.entries(palette))
      expect(
        await page.evaluate(
          (token) =>
            getComputedStyle(document.documentElement)
              .getPropertyValue(token)
              .trim(),
          token,
        ),
      ).toBe(color);
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(248, 247, 245)",
    );
    await expect(page.locator("body")).toHaveCSS("color", "rgb(31, 27, 23)");
    await expect(page.locator(".screen-library")).toHaveCSS(
      "background-color",
      "rgb(243, 238, 232)",
    );
    await expect(page.locator(".screen-item[aria-current=page]")).toHaveCSS(
      "background-color",
      "rgb(228, 214, 200)",
    );
    await expect(page.locator(".capture-stage").first()).toHaveCSS(
      "background-color",
      "rgb(243, 238, 232)",
    );
    expect(await page.locator("[role=tab][data-state=active]").evaluate((tab) => getComputedStyle(tab, "::after").backgroundColor)).toBe("rgb(154, 70, 0)");
    await page.getByRole("tab", { name: /Feedback/ }).click();
    const button = page.getByRole("button", {
      name: "Add note",
      exact: true,
    });
    await expect(button).toHaveCSS("background-color", "rgb(154, 70, 0)");
    await button.hover();
    await expect(button).toHaveCSS("background-color", "rgb(124, 56, 0)");
    await page.getByLabel("What should change?", { exact: true }).focus();
    await expect(page.getByLabel("What should change?", { exact: true })).toBeFocused();
    await expect(page.getByLabel("What should change?", { exact: true })).toHaveCSS("outline", "rgb(154, 70, 0) solid 2px");
    for (const width of [1440, 912, 760, 540, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(page.locator(".review-workspace")).toHaveCSS(
        "background-color",
        "rgb(248, 247, 245)",
      );
    }
    await page.getByRole("button", { name: "Show screen library" }).click();
    await expect(page.locator(".screen-library")).toBeVisible();
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(248, 247, 245)",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
