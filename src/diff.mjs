import sharp from "sharp";
import { createHash } from "node:crypto";
import { Fault, requireThat } from "./validation.mjs";

// Version all normalization and scoring choices. Pixel evidence is not acceptance.
const algorithm = `rgba-max-channel-v1/sharp-${sharp.versions.sharp}/vips-${sharp.versions.vips}`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function createDiff(store, input) {
  const left = store.getCapture(input.left),
    right = store.getCapture(input.right);
  requireThat(
    left.screen === right.screen &&
      JSON.stringify(left.variant) === JSON.stringify(right.variant),
    "Diff requires the same screen and variant",
  );
  const threshold = input.threshold ?? 0;
  requireThat(
    Number.isInteger(threshold) && threshold >= 0 && threshold <= 255,
    "Threshold must be an integer from 0 to 255",
  );
  requireThat(
    input.masks === undefined || Array.isArray(input.masks),
    "Masks must be an array",
  );
  const masks = (input.masks ?? []).map((m) => {
    requireThat(
      m &&
        ["x", "y", "width", "height"].every((k) => Number.isInteger(m[k])) &&
        m.x >= 0 &&
        m.y >= 0 &&
        m.width > 0 &&
        m.height > 0,
      "Masks require positive integer pixel rectangles",
    );
    return { x: m.x, y: m.y, width: m.width, height: m.height };
  });
  requireThat(masks.length <= 100, "At most 100 masks");
  const identity = {
    left: left.id,
    right: right.id,
    algorithm,
    threshold,
    masks,
  };
  const id = hash(JSON.stringify(identity));
  const existing = store.findDiff(id);
  if (existing) return existing;
  const decode = async (c) => {
    try {
      const image = sharp(store.image(c.id).bytes, {
        limitInputPixels: 16_000_000,
        failOn: "error",
      });
      const meta = await image.metadata();
      requireThat(
        (meta.pages ?? 1) === 1,
        "Animated captures cannot be pixel-compared",
      );
      return await image
        .rotate()
        .toColourspace("srgb")
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch (e) {
      if (e instanceof Fault) throw e;
      throw new Fault(
        422,
        "Cannot decode capture for comparison (limit: 16 million pixels)",
      );
    }
  };
  const a = await decode(left),
    b = await decode(right);
  const dimensions = {
    left: { width: a.info.width, height: a.info.height },
    right: { width: b.info.width, height: b.info.height },
  };
  const value = {
    id,
    ...identity,
    dimensions,
    leftHash: left.hash,
    rightHash: right.hash,
    fixtureStatus:
      left.fixture !== right.fixture
        ? "mismatch"
        : /unspecified|unknown/.test(left.fixture)
          ? "unknown"
          : "same-reported-fixture",
    createdAt: new Date().toISOString(),
    acceptance: "not-assessed",
  };
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    return store.saveDiff({
      ...value,
      status: "dimension-mismatch",
      image: null,
      changedPixels: null,
      comparedPixels: 0,
    });
  }
  const { width, height } = a.info;
  for (const m of masks)
    requireThat(
      m.x + m.width <= width && m.y + m.height <= height,
      "Mask extends outside the capture",
    );
  const ignored = new Uint8Array(width * height);
  for (const m of masks)
    for (let y = m.y; y < m.y + m.height; y++)
      ignored.fill(1, y * width + m.x, y * width + m.x + m.width);
  const output = Buffer.alloc(width * height * 4);
  let changedPixels = 0,
    maskedPixels = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    output[i + 3] = 255;
    if (ignored[p]) {
      maskedPixels++;
      output[i] = 60;
      output[i + 1] = 110;
      output[i + 2] = 220;
      continue;
    }
    let delta = 0;
    for (let k = 0; k < 4; k++)
      delta = Math.max(delta, Math.abs(a.data[i + k] - b.data[i + k]));
    if (delta > threshold) {
      changedPixels++;
      output[i] = 230;
      output[i + 1] = 30;
      output[i + 2] = 100;
    } else {
      const grey = Math.round((b.data[i] + b.data[i + 1] + b.data[i + 2]) / 3);
      output[i] =
        output[i + 1] =
        output[i + 2] =
          Math.round(210 + (grey * 45) / 255);
    }
  }
  const comparedPixels = width * height - maskedPixels;
  requireThat(comparedPixels > 0, "Masks exclude every pixel");
  const bytes = await sharp(output, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return store.saveDiff(
    {
      ...value,
      status: "measured",
      changedPixels,
      comparedPixels,
      maskedPixels,
      changedRatio: changedPixels / comparedPixels,
      image: hash(bytes),
      url: `/api/diffs/${id}/image`,
    },
    bytes,
  );
}
