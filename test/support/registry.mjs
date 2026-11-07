import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Store } from "../../src/store.mjs";
export async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "screens-coverage-"));
  const store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.project({ id: "demo", name: "Demo", repository: "example/demo" });
  store.screen({
    project: "demo",
    key: "home",
    title: "Home",
    route: "/",
    source: "home.js",
    recipe: "home",
    group: "Pages",
  });
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "white" },
  })
    .png()
    .toBuffer();
  const capture = (extra = {}) =>
    store.capture({ screen: "demo/home", role: "current", bytes, ...extra });
  return { store, dir, bytes, capture };
}
