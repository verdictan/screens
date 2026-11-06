import { Store } from "../src/store.mjs";
import sharp from "sharp";
const store = new Store(process.env.SCREENS_HOME);
try {
  store.project({ id: "proof-fixture", name: "Proof fixture" });
  const screen = store.screen({
    project: "proof-fixture",
    key: "overview",
    title: "Project overview",
    group: "Workspace",
  });
  const captures = [];
  for (const role of ["current", "target", "pr"]) {
    const svg = `<svg width="720" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="480" fill="#f5f5f5"/><rect x="40" y="40" width="640" height="400" rx="16" fill="white"/><text x="70" y="100" font-family="sans-serif" font-size="26" fill="#222">Project overview</text><text x="70" y="142" font-family="sans-serif" font-size="15" fill="#666">Deterministic demonstration fixture</text><rect x="70" y="180" width="580" height="1" fill="#ddd"/><text x="70" y="230" font-family="sans-serif" font-size="18" fill="#333">Brief approved</text><text x="70" y="285" font-family="sans-serif" font-size="18" fill="#333">Design in review</text><rect x="70" y="340" width="${role === "current" ? 150 : 190}" height="44" rx="8" fill="#27272a"/><text x="90" y="368" font-family="sans-serif" font-size="15" fill="white">View details</text></svg>`;
    captures.push(
      store.capture({
        screen: screen.id,
        role,
        bytes: await sharp(Buffer.from(svg)).png().toBuffer(),
        revision: "proof-fixture",
        fixture: "screens-picker-proof-seed-1",
        provenance:
          "Generated deterministic test fixture; not a customer application capture",
        variant: { device: "desktop", viewport: "720x480" },
      }).id,
    );
  }
  store.run({
    project: "proof-fixture",
    title: "Design review · proof fixture",
    captureIds: captures,
  });
} finally {
  store.close();
}
