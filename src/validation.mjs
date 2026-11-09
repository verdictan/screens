export class Fault extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    if (details.code) this.code = details.code;
    if (details.recovery) this.recovery = details.recovery;
  }
}
export function requireThat(condition, message, status = 400, details) {
  if (!condition) throw new Fault(status, message, details);
}
export function revisionRecovery(type, id, read) {
  return { code: "revision-conflict", recovery: { kind: "read-latest", record: { type, id: id ?? null },
    ...(read ? { read } : {}), requires: ["read the latest record", "reconcile changes", "submit expectedRevision"] } };
}
export function text(value, label, max = 500) {
  requireThat(
    typeof value === "string" && value.trim().length > 0 && value.length <= max,
    `Invalid ${label}`,
  );
  return value.trim();
}
export function key(value, label = "ID") {
  const v = text(value, label, 200);
  requireThat(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(v), `Invalid ${label}`);
  return v;
}
export function choice(value, values, label) {
  requireThat(
    values.includes(value),
    `Invalid ${label}; expected ${values.join(", ")}`,
  );
  return value;
}
export function point(value) {
  if (value === undefined || value === null) return null;
  requireThat(
    typeof value === "object" &&
      ["x", "y"].every(
        (k) => Number.isFinite(value[k]) && value[k] >= 0 && value[k] <= 1,
      ),
    "Pin coordinates must be between 0 and 1",
  );
  return { x: value.x, y: value.y };
}
export function raster(bytes) {
  requireThat(
    Buffer.isBuffer(bytes) &&
      bytes.length > 12 &&
      bytes.length <= 25 * 1024 * 1024,
    "Image must be 13 bytes to 25 MB",
  );
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  throw new Fault(400, "Only PNG, JPEG and WebP captures are supported");
}
export function variant(value = {}) {
  const result = {};
  for (const k of ["device", "theme", "viewport", "locale", "textScale", "browser"]) {
    result[k] = text(
      value[k] ??
        {
          device: "desktop",
          theme: "light",
          viewport: "unspecified",
          locale: "en",
          textScale: "default",
          browser: "unspecified",
        }[k],
      k,
    );
  }
  return result;
}
