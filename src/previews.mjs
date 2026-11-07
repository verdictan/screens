import sharp from "sharp";
import { createHash } from "node:crypto";
import { rgbaToThumbHash } from "thumbhash";
import { Fault } from "./validation.mjs";

export async function preparePreview(store, bytes) {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const existing = store.getPreview(hash);
  if (existing) return existing;
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000 });
    const metadata = await image.metadata();
    const rotated = [5, 6, 7, 8].includes(metadata.orientation);
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;
    const { data, info } = await image.rotate().resize(100, 100, { fit: "inside" })
      .toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return store.savePreview(hash, {
      width, height,
      thumbhash: Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString("base64"),
    });
  } catch {
    throw new Fault(422, "Cannot prepare image preview (limit: 16 million pixels)");
  }
}

export async function prepareCaptures(store, captures) {
  for (const capture of captures) {
    if (!capture.preview) { await preparePreview(store, store.image(capture.id).bytes); }
  }
}
