import sharp from "sharp";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, isAbsolute, dirname } from "node:path";
import { createDiff } from "./diff.mjs";
import { requireThat, text } from "./validation.mjs";

const require = createRequire(import.meta.url);
const ocrModes = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const json = (value) => JSON.stringify(canonical(value));
const parse = (row) => row ? JSON.parse(row.data) : null;
const string = { type: "string" };
const boolean = { type: "boolean" };
const integer = { type: "integer" };
const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const anyObject = { type: "object", additionalProperties: true };
const now = () => new Date().toISOString();

export function initializeEvidence(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS derived_evidence (
    id TEXT PRIMARY KEY, capture TEXT NOT NULL REFERENCES captures(id), kind TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS derived_capture ON derived_evidence(capture,kind);
    CREATE TABLE IF NOT EXISTS source_links (
    id TEXT PRIMARY KEY, capture TEXT NOT NULL REFERENCES captures(id), note TEXT, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ci_reports (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
}

export function saveDerived(store, captureId, kind, data, algorithm = "reported-v1") {
  initializeEvidence(store);
  const capture = store.getCapture(captureId);
  const identity = { capture: capture.id, kind, algorithm, data };
  const id = hash(json(identity));
  const existing = parse(store.db.prepare("SELECT data FROM derived_evidence WHERE id=?").get(id));
  if (existing) return existing;
  const record = {
    id, ...identity, captureHash: capture.hash, sourceRevision: capture.revision,
    fixture: capture.fixture, createdAt: now(), acceptance: "not-assessed",
  };
  store.transaction(() => {
    const inserted = store.db.prepare("INSERT OR IGNORE INTO derived_evidence VALUES (?,?,?,?)")
      .run(id, capture.id, kind, JSON.stringify(record));
    if (inserted.changes) store.event("derived-evidence.added", { derived: id, capture: capture.id, kind });
  });
  return parse(store.db.prepare("SELECT data FROM derived_evidence WHERE id=?").get(id));
}

export function getDerived(store, id) {
  initializeEvidence(store);
  const value = parse(store.db.prepare("SELECT data FROM derived_evidence WHERE id=?").get(text(id, "derived evidence ID")));
  requireThat(value, "Derived evidence not found", 404);
  return value;
}

export function listDerived(store, { capture, kind, query = "", limit = 50, cursor = 0 } = {}) {
  initializeEvidence(store);
  store.getCapture(capture);
  const rows = store.db.prepare("SELECT rowid,data FROM derived_evidence WHERE capture=? AND rowid>? ORDER BY rowid")
    .all(capture, Number(cursor));
  const filtered = rows.filter((row) => {
    const value = parse(row);
    return (!kind || value.kind === kind) && (!query || JSON.stringify(value.data).toLowerCase().includes(query.toLowerCase()));
  });
  const page = filtered.slice(0, Math.max(1, Math.min(200, Number(limit))));
  return { items: page.map(parse), nextCursor: filtered.length > page.length ? page.at(-1).rowid : null };
}

function latestDerived(store, capture, kind) {
  initializeEvidence(store);
  return parse(store.db.prepare("SELECT data FROM derived_evidence WHERE capture=? AND kind=? ORDER BY rowid DESC LIMIT 1").get(capture, kind));
}

async function captureBytes(store, id) {
  return store.image(id).bytes;
}

export async function extractOcr(store, input) {
  const capture = store.getCapture(input.capture);
  const language = input.language || "eng";
  const psm = input.psm ?? 3;
  requireThat(language === "eng", "Screens includes the English OCR model");
  requireThat(ocrModes.includes(psm), "Use an OCR segmentation mode from 3–11 or 13");
  const image = await sharp(await captureBytes(store, capture.id), { limitInputPixels: 16_000_000 })
    .rotate().png().toBuffer({ resolveWithObject: true });
  const { createWorker } = await import("tesseract.js");
  const runtimeRequire = createRequire(require.resolve("tesseract.js"));
  const engine = `tesseract.js-${runtimeRequire("../package.json").version}/core-${runtimeRequire("tesseract.js-core/package.json").version}`;
  const worker = await createWorker(language, 1, {
    workerPath: require.resolve("tesseract.js/src/worker-script/node/index.js"),
    langPath: join(dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int"),
    cacheMethod: "none",
    gzip: true,
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
    const { data } = await worker.recognize(image.data, {}, { text: true, tsv: true });
    const words = data.tsv.trimEnd().split(/\r?\n/).slice(1).flatMap((line) => {
      const fields = line.split("\t");
      if (Number(fields[0]) !== 5 || !fields.slice(11).join("\t").trim()) return [];
      const [x, y, width, height, confidence] = fields.slice(6, 11).map(Number);
      return [{ text: fields.slice(11).join("\t"), confidence, page: Number(fields[1]),
        block: Number(fields[2]), paragraph: Number(fields[3]), line: Number(fields[4]),
        pixels: { x, y, width, height }, region: { x: x / image.info.width, y: y / image.info.height, width: width / image.info.width, height: height / image.info.height } }];
    });
    const lines = [];
    for (const word of words) {
      const key = [word.page, word.block, word.paragraph, word.line].join(":");
      if (lines.at(-1)?.key !== key) lines.push({ key, text: "", words: [] });
      const line = lines.at(-1);
      line.text += `${line.text ? " " : ""}${word.text}`;
      line.words.push(word);
    }
    return saveDerived(store, capture.id, "ocr", {
      engine, language, model: "eng/4.0.0_best_int", psm, width: image.info.width, height: image.info.height,
      text: lines.map((line) => line.text).join("\n"), lines, words,
    }, "tesseract-wasm-tsv-v1");
  } finally { await worker.terminate(); }
}

function lineChanges(left, right) {
  const rows = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--)
    for (let j = right.length - 1; j >= 0; j--)
      rows[i][j] = left[i].text === right[j].text ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const changes = [];
  let i = 0, j = 0, hunk = null;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i].text === right[j].text) { i++; j++; hunk = null; continue; }
    if (!hunk) { hunk = { beforeLine: i + 1, afterLine: j + 1, removed: [], added: [] }; changes.push(hunk); }
    if (j >= right.length || i < left.length && rows[i + 1][j] >= rows[i][j + 1]) hunk.removed.push(left[i++]);
    else hunk.added.push(right[j++]);
  }
  return changes;
}

export function compareText(store, input) {
  const left = input.leftOcr ? getDerived(store, input.leftOcr) : latestDerived(store, input.left, "ocr");
  const right = input.rightOcr ? getDerived(store, input.rightOcr) : latestDerived(store, input.right, "ocr");
  requireThat(left?.kind === "ocr" && right?.kind === "ocr", "Extract OCR for both captures first");
  requireThat(left.capture === input.left && right.capture === input.right, "OCR records must belong to the compared captures");
  const changes = lineChanges(left.data.lines, right.data.lines);
  return saveDerived(store, input.right, "text-comparison", {
    left: input.left, right: input.right, leftOcr: left.id, rightOcr: right.id, changes,
    addedLines: changes.reduce((n, change) => n + change.added.length, 0),
    removedLines: changes.reduce((n, change) => n + change.removed.length, 0),
    identical: changes.length === 0,
  }, "ocr-line-lcs-v1");
}

export function searchOcr(store, input) {
  initializeEvidence(store);
  const query = text(input.query, "search query", 2000).toLowerCase();
  const rows = store.db.prepare("SELECT d.rowid,d.data,s.project FROM derived_evidence d JOIN captures c ON c.id=d.capture JOIN screens s ON s.id=c.screen WHERE d.kind='ocr' AND d.rowid>? ORDER BY d.rowid")
    .all(Number(input.cursor || 0));
  const matched = rows.filter((row) => (!input.project || row.project === input.project) && parse(row).data.text.toLowerCase().includes(query));
  const page = matched.slice(0, Math.max(1, Math.min(200, Number(input.limit || 50))));
  return { items: page.map((row) => {
    const record = parse(row);
    return { id: record.id, capture: record.capture, sourceRevision: record.sourceRevision,
      matches: record.data.lines.filter((line) => line.text.toLowerCase().includes(query)) };
  }), nextCursor: matched.length > page.length ? page.at(-1).rowid : null };
}

export function addSourceLink(store, input) {
  initializeEvidence(store);
  const capture = store.getCapture(input.capture);
  const file = text(input.file, "repository-relative source file", 2000).replaceAll("\\", "/");
  requireThat(!isAbsolute(file) && !/^[a-zA-Z]:/.test(file) && !file.split("/").includes(".."), "Source files must be repository-relative");
  const note = input.note ? parse(store.db.prepare("SELECT data FROM notes WHERE id=?").get(input.note)) : null;
  requireThat(!input.note || note?.capture === capture.id, "Source link note must belong to this capture");
  const evidence = input.evidence ? store.getEvidence(input.evidence) : null;
  requireThat(!evidence || evidence.capture === capture.id, "Source link evidence must belong to this capture");
  const revision = text(input.revision || capture.revision, "source revision");
  requireThat(revision === capture.revision, "Source link revision must match the capture revision");
  const identity = { capture: capture.id, note: input.note || null, evidence: input.evidence || null,
    file, symbol: input.symbol || null, line: input.line || null, revision };
  const id = hash(json(identity));
  const value = { id, ...identity, createdAt: now(), provenance: "reporter-supplied" };
  store.db.prepare("INSERT OR IGNORE INTO source_links VALUES (?,?,?,?)").run(id, capture.id, value.note, JSON.stringify(value));
  return parse(store.db.prepare("SELECT data FROM source_links WHERE id=?").get(id));
}

export function sourceLinks(store, input) {
  initializeEvidence(store);
  store.getCapture(input.capture);
  return store.db.prepare("SELECT data FROM source_links WHERE capture=? ORDER BY rowid").all(input.capture)
    .map(parse).filter((link) => !input.note || link.note === input.note);
}

export function addSelectorNote(store, input) {
  const record = input.geometry ? getDerived(store, input.geometry) : latestDerived(store, input.capture, "selectors");
  requireThat(record?.kind === "selectors" && record.capture === input.capture, "Capture has no recorded selector geometry");
  const match = record.data.items.find((item) => item.selector === input.selector);
  requireThat(match?.region, "Selector has no visible region in this capture");
  return store.addNote({ capture: input.capture, text: input.text, author: input.author,
    region: match.region, point: null });
}

export async function perceptualComparison(store, input) {
  const left = store.getCapture(input.left), right = store.getCapture(input.right);
  requireThat(left.screen === right.screen && json(left.variant) === json(right.variant), "Compare captures of the same screen and variant");
  const decode = async (capture) => sharp(await captureBytes(store, capture.id), { limitInputPixels: 16_000_000 })
    .rotate().toColourspace("srgb").flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = await decode(left), b = await decode(right);
  const dimensions = { left: { width: a.info.width, height: a.info.height }, right: { width: b.info.width, height: b.info.height } };
  const data = { left: left.id, right: right.id, dimensions, colorSpace: "srgb", alphaBackground: "white", window: 8 };
  if (a.info.width !== b.info.width || a.info.height !== b.info.height)
    return saveDerived(store, right.id, "perceptual", { ...data, status: "dimension-mismatch", ssim: null, rmse: null }, `ssim-block8-v1/sharp-${sharp.versions.sharp}`);
  const width = a.info.width, height = a.info.height;
  let squaredError = 0, score = 0, windows = 0;
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) {
    const values = [];
    let sumA = 0, sumB = 0;
    for (let yy = y; yy < Math.min(y + 8, height); yy++) for (let xx = x; xx < Math.min(x + 8, width); xx++) {
      const offset = (yy * width + xx) * 3;
      const lum = (bytes) => 0.2126 * bytes[offset] + 0.7152 * bytes[offset + 1] + 0.0722 * bytes[offset + 2];
      const la = lum(a.data), lb = lum(b.data);
      values.push([la, lb]); sumA += la; sumB += lb;
      for (let channel = 0; channel < 3; channel++) squaredError += (a.data[offset + channel] - b.data[offset + channel]) ** 2;
    }
    const meanA = sumA / values.length, meanB = sumB / values.length;
    let varA = 0, varB = 0, covariance = 0;
    for (const [la, lb] of values) { varA += (la - meanA) ** 2; varB += (lb - meanB) ** 2; covariance += (la - meanA) * (lb - meanB); }
    const divisor = Math.max(1, values.length - 1);
    varA /= divisor; varB /= divisor; covariance /= divisor;
    score += ((2 * meanA * meanB + 6.5025) * (2 * covariance + 58.5225)) /
      ((meanA ** 2 + meanB ** 2 + 6.5025) * (varA + varB + 58.5225));
    windows++;
  }
  const mse = squaredError / (width * height * 3);
  return saveDerived(store, right.id, "perceptual", { ...data, status: "measured", ssim: score / windows,
    rmse: Math.sqrt(mse) / 255, psnr: mse === 0 ? null : 10 * Math.log10(255 ** 2 / mse), identical: mse === 0,
  }, `ssim-block8-v1/sharp-${sharp.versions.sharp}`);
}

function readPath(value, path) {
  return path.split(".").reduce((current, key) => current && Object.hasOwn(current, key) ? current[key] : undefined, value);
}

export function fixtureContract(store, input) {
  const capture = store.getCapture(input.capture);
  const recorded = input.record ? getDerived(store, input.record) : latestDerived(store, capture.id, "fixture");
  requireThat(!recorded || recorded.capture === capture.id && recorded.kind === "fixture", "Fixture record must belong to the capture");
  const contract = input.contract;
  const value = recorded?.data || {};
  const issues = [];
  if (contract.name !== undefined && capture.fixture !== contract.name) issues.push({ path: "fixture", expected: contract.name, actual: capture.fixture });
  if (contract.version !== undefined && value.version !== contract.version) issues.push({ path: "version", expected: contract.version, actual: value.version ?? null });
  for (const path of contract.required || []) if (readPath(value, path) === undefined) issues.push({ path, issue: "missing" });
  for (const [path, expected] of Object.entries(contract.equals || {})) {
    const actual = readPath(value, path);
    if (json(actual) !== json(expected)) issues.push({ path, expected, actual: actual ?? null });
  }
  if (input.other) {
    const other = store.getCapture(input.other);
    const otherFixture = latestDerived(store, other.id, "fixture");
    if (other.fixture !== capture.fixture) issues.push({ path: "pair.fixture", expected: capture.fixture, actual: other.fixture });
    if (value.version !== otherFixture?.data.version) issues.push({ path: "pair.version", expected: value.version ?? null, actual: otherFixture?.data.version ?? null });
  }
  return saveDerived(store, capture.id, "fixture-contract", { contract, fixtureRecord: recorded?.id || null,
    other: input.other || null, passed: issues.length === 0, issues }, "fixture-contract-v1");
}

async function fontReport(page) {
  const result = await page.evaluate(() => {
    const selector = (element) => {
      const parts = [];
      for (let current = element; current && current.nodeType === 1; current = current.parentElement) {
        let index = 1;
        for (let before = current.previousElementSibling; before; before = before.previousElementSibling) if (before.tagName === current.tagName) index++;
        parts.unshift(`${current.localName}:nth-of-type(${index})`);
      }
      return parts.join(" > ");
    };
    const elements = [...document.querySelectorAll("body *")].filter((element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim())).map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { selector: selector(element), fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
        fontStyle: style.fontStyle, visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" };
    }).filter((element) => element.visible);
    return { declared: [...document.fonts].map((font) => ({ family: font.family, status: font.status, weight: font.weight, style: font.style })), elements };
  });
  const browser = page.context().browser()?.browserType().name();
  if (browser !== "chromium") return { ...result, actualFontSupport: false, actualFontReason: "Platform font inspection requires Chromium" };
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument");
    for (const element of result.elements) {
      const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: element.selector });
      element.platformFonts = nodeId ? (await session.send("CSS.getPlatformFontsForNode", { nodeId })).fonts : [];
      const first = element.fontFamily.split(",")[0].trim().replace(/^['"]|['"]$/g, "").toLowerCase();
      const generic = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded"].includes(first);
      element.fallbackFonts = generic ? [] : element.platformFonts.filter((font) => font.glyphCount > 0 && font.familyName.toLowerCase() !== first);
    }
    return { ...result, actualFontSupport: true };
  } finally { await session.detach(); }
}

export function startBrowserEvidence(page, settings = {}) {
  let consoleItems = [], networkItems = [], generation = 0;
  const onConsole = (message) => consoleItems.push({ type: message.type(), text: message.text(), location: message.location() });
  const onError = (error) => consoleItems.push({ type: "pageerror", text: error.message, stack: error.stack });
  const onRequestFailed = (request) => {
    if (requestGenerations.get(request) === generation) networkItems.push({ type: "requestfailed", url: request.url(), method: request.method(), resourceType: request.resourceType(), error: request.failure()?.errorText });
  };
  const requestGenerations = new WeakMap();
  const onRequest = (request) => requestGenerations.set(request, generation);
  const onResponse = (response) => {
    if (response.status() >= 400 && requestGenerations.get(response.request()) === generation)
      networkItems.push({ type: "http-error", url: response.url(), status: response.status(), method: response.request().method(), resourceType: response.request().resourceType() });
  };
  if (settings.console) { page.on("console", onConsole); page.on("pageerror", onError); }
  if (settings.network) { page.on("request", onRequest); page.on("requestfailed", onRequestFailed); page.on("response", onResponse); }
  return {
    reset() { consoleItems = []; networkItems = []; generation++; },
    async collect({ fullPage = true, fixture, selectors = settings.selectors || [] } = {}) {
      const collected = {};
      if (settings.dom) collected.dom = { url: page.url(), title: await page.title(), html: await page.content() };
      if (settings.fonts) collected.fonts = await fontReport(page);
      if (selectors.length) {
        const items = [];
        for (const specification of selectors) {
          const selector = typeof specification === "string" ? specification : specification.selector;
          const locator = page.locator(selector);
          const count = await locator.count();
          requireThat(count === 1, `Selector ${selector} must match one element; matched ${count}`);
          const geometry = await locator.evaluate((element, fullPage) => {
            const root = document.documentElement, body = document.body;
            const width = fullPage ? Math.max(root.scrollWidth, root.clientWidth, body?.scrollWidth || 0, body?.offsetWidth || 0) : innerWidth;
            const height = fullPage ? Math.max(root.scrollHeight, root.clientHeight, body?.scrollHeight || 0, body?.offsetHeight || 0) : innerHeight;
            const rect = element.getBoundingClientRect();
            const left = Math.max(0, rect.left + (fullPage ? scrollX : 0));
            const top = Math.max(0, rect.top + (fullPage ? scrollY : 0));
            const right = Math.min(width, rect.right + (fullPage ? scrollX : 0));
            const bottom = Math.min(height, rect.bottom + (fullPage ? scrollY : 0));
            return { width, height, region: right > left && bottom > top ? { x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height } : null };
          }, fullPage);
          items.push({ ...(typeof specification === "string" ? {} : specification), selector, ...geometry });
        }
        collected.selectors = { fullPage, items };
      }
      if (settings.accessibility) {
        const { default: axe } = await import("axe-core");
        await page.evaluate(axe.source);
        const config = settings.accessibility === true ? {} : settings.accessibility;
        collected.accessibility = await page.evaluate(async ({ context, options }) => globalThis.axe.run(context || document, options || {}), config);
      }
      if (fixture && typeof fixture === "object") collected.fixture = fixture;
      if (settings.console) collected.console = { items: [...consoleItems] };
      if (settings.network) collected.network = { items: [...networkItems] };
      return collected;
    },
    dispose() {
      page.off("console", onConsole); page.off("pageerror", onError);
      page.off("request", onRequest); page.off("requestfailed", onRequestFailed); page.off("response", onResponse);
    },
  };
}

export function attachBrowserEvidence(store, captureId, collected) {
  const records = Object.entries(collected).map(([kind, data]) => saveDerived(store, captureId, kind, data, "browser-observation-v1"));
  const notes = [];
  for (const item of collected.selectors?.items || []) if (item.text && item.region) {
    const author = item.author || "capture recipe";
    const previous = store.getScreen(store.getCapture(captureId).screen).notes.find((note) =>
      note.capture === captureId && note.text === item.text && note.author === author && json(note.region) === json(item.region));
    notes.push(previous || store.addNote({ capture: captureId, text: item.text, author, region: item.region }));
  }
  let accessibilityEvidence = null;
  if (collected.accessibility) {
    const report = collected.accessibility;
    const existing = store.listEvidence({ capture: captureId }).find((item) => item.artifact?.hash === hash(Buffer.from(JSON.stringify(report))) && item.kind === "accessibility");
    accessibilityEvidence = existing || store.addEvidence({ capture: captureId, kind: "accessibility", method: "automated",
      outcome: report.violations.length ? "fail" : report.incomplete.length ? "not-run" : "pass",
      assertion: "Configured axe-core rules report no violations in the captured document",
      procedure: "Run axe-core against the rendered browser document immediately before capture",
      observation: `${report.violations.length} violations; ${report.incomplete.length} results need review; ${report.passes.length} rules passed. This does not establish complete accessibility.`,
      author: `axe-core ${report.testEngine?.version || "unknown"}`,
      artifactBase64: Buffer.from(JSON.stringify(report)).toString("base64"), artifactType: "application/json" });
  }
  return { records, notes, accessibilityEvidence };
}

export async function evaluateCI(store, input) {
  initializeEvidence(store);
  requireThat(input.run || input.jobs?.length, "Supply a comparison run or capture jobs");
  const run = input.run ? store.compare(input.run) : null, policy = input.policy || {};
  const pair = policy.pair || ["current", "pr"];
  requireThat(pair.length === 2 && pair.every((role) => ["current", "target", "pr"].includes(role)), "Policy pair needs two capture roles");
  const checks = [];
  const add = (entry, rule, status, message, details = {}) => checks.push({ screen: entry.screen, title: entry.title,
    variant: entry.variant, capture: entry.captures[pair[1]]?.id || entry.captures[pair[0]]?.id || null, rule, status, message, ...details });
  for (const entry of run?.entries || []) {
    const left = entry.captures[pair[0]], right = entry.captures[pair[1]];
    if (!left || !right) {
      add(entry, "capture-pair", policy.failOnMissing === false ? "not-run" : "fail", `Missing ${!left ? pair[0] : pair[1]} capture`);
      continue;
    }
    if (policy.requireMatchingFixture) add(entry, "fixture-match", left.fixture === right.fixture && !/unknown|unspecified/.test(left.fixture) ? "pass" : "fail", `${left.fixture} / ${right.fixture}`);
    if (policy.maxChangedRatio !== undefined || policy.maxChangedPixels !== undefined) {
      await captureBytes(store, left.id); await captureBytes(store, right.id);
      const diff = await createDiff(store, { left: left.id, right: right.id, threshold: policy.threshold ?? 0, masks: policy.masks || [], ...(policy.region ? { region: policy.region } : {}) });
      const passed = diff.status === "measured" && (policy.maxChangedRatio === undefined || diff.changedRatio <= policy.maxChangedRatio) &&
        (policy.maxChangedPixels === undefined || diff.changedPixels <= policy.maxChangedPixels);
      add(entry, "pixel-difference", passed ? "pass" : "fail", diff.status === "measured" ? `${diff.changedPixels} changed pixels (${(diff.changedRatio * 100).toFixed(3)}%)` : "Capture dimensions differ", { diff: diff.id, left: left.id, right: right.id });
    }
    if (policy.minSsim !== undefined) {
      const metric = await perceptualComparison(store, { left: left.id, right: right.id });
      add(entry, "perceptual-similarity", metric.data.status === "measured" && metric.data.ssim >= policy.minSsim ? "pass" : "fail", `SSIM: ${metric.data.ssim ?? "not measured"}`, { derived: metric.id });
    }
    if (policy.fixtureContract) {
      const result = fixtureContract(store, { capture: right.id, other: left.id, contract: policy.fixtureContract });
      add(entry, "fixture-contract", result.data.passed ? "pass" : "fail", result.data.passed ? "Fixture contract matched" : JSON.stringify(result.data.issues), { derived: result.id });
    }
    if (policy.maxAccessibilityViolations !== undefined) {
      const evidence = latestDerived(store, right.id, "accessibility");
      const count = evidence?.data.violations.length;
      add(entry, "accessibility", count !== undefined && count <= policy.maxAccessibilityViolations ? "pass" : "fail", count === undefined ? "Accessibility evidence missing" : `${count} rule violations`, { derived: evidence?.id || null });
    }
    for (const [kind, enabled, bad] of [
      ["console", policy.failOnConsoleErrors, (item) => ["error", "pageerror"].includes(item.type)],
      ["network", policy.failOnNetworkErrors, () => true],
    ]) if (enabled) {
      const evidence = latestDerived(store, right.id, kind), errors = evidence?.data.items.filter(bad);
      add(entry, kind, errors && !errors.length ? "pass" : "fail", !errors ? `${kind} evidence missing` : `${errors.length} errors`, { derived: evidence?.id || null });
    }
    for (const kind of policy.requireEvidence || []) {
      const evidence = latestDerived(store, right.id, kind);
      add(entry, `evidence-${kind}`, evidence ? "pass" : "fail", evidence ? `${kind} evidence recorded` : `${kind} evidence missing`, { derived: evidence?.id || null });
    }
  }
  for (const screen of run?.uncoveredScreens || []) checks.push({ screen: screen.id, title: screen.title, rule: "capture-coverage", status: policy.failOnMissing === false ? "not-run" : "fail", message: "Registered screen has no captures in this run", capture: null });
  let pendingJobs = false;
  for (const id of input.jobs || []) {
    const job = parse(store.db.prepare("SELECT data FROM capture_jobs WHERE id=?").get(id));
    requireThat(job, `Capture job not found: ${id}`, 404);
    const pending = ["queued", "running"].includes(job.status);
    pendingJobs ||= pending;
    checks.push({ screen: job.config?.project?.id || "capture", title: job.title || id, job: id,
      capture: null, rule: "capture-job", status: job.status === "completed" ? "pass" : pending ? "not-run" : "fail",
      message: job.error ? typeof job.error === "string" ? job.error : JSON.stringify(job.error) : `Capture job ${job.status}`,
      result: job.result, revision: job.ref, capturedIds: job.captures || [],
    });
  }
  requireThat(checks.length > 0, "Policy did not select any checks");
  const failed = checks.some((check) => check.status === "fail");
  const report = { run: run?.id || null, title: run?.title || "Capture jobs", source: run?.source || null,
    jobs: input.jobs || [], policy, checks, passed: !failed && !pendingJobs,
    complete: !pendingJobs, exitCode: failed ? 1 : pendingJobs ? 2 : 0, acceptance: "not-assessed", algorithm: "ci-policy-v1" };
  const id = hash(json(report));
  const value = { id, ...report, createdAt: now() };
  store.db.prepare("INSERT OR IGNORE INTO ci_reports VALUES (?,?)").run(id, JSON.stringify(value));
  return parse(store.db.prepare("SELECT data FROM ci_reports WHERE id=?").get(id));
}

const escapeXml = (value) => String(value).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const escapeMarkdown = (value) => String(value).replace(/[\\`*_{}\[\]<>|]/g, "\\$&").replaceAll("\n", " ");

export function formatReport(store, report, format) {
  if (format === "json") return JSON.stringify(report, null, 2) + "\n";
  if (format === "junit") {
    const cases = report.checks.map((check) => {
      const result = check.status === "fail" ? `<failure message="${escapeXml(check.message)}">${escapeXml(JSON.stringify(check))}</failure>` : check.status === "not-run" ? `<skipped message="${escapeXml(check.message)}"/>` : "";
      return `    <testcase classname="${escapeXml(check.screen)}" name="${escapeXml(check.rule + (check.variant ? ` ${JSON.stringify(check.variant)}` : ""))}">${result}</testcase>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="${escapeXml(report.title)}" tests="${report.checks.length}" failures="${report.checks.filter((check) => check.status === "fail").length}" skipped="${report.checks.filter((check) => check.status === "not-run").length}">\n${cases.join("\n")}\n</testsuite></testsuites>\n`;
  }
  if (format === "sarif") {
    const rules = [...new Set(report.checks.map((check) => check.rule))];
    return JSON.stringify({ version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: {
      name: "Screens", informationUri: "https://github.com/verdictan/screens", rules: rules.map((id) => ({ id, shortDescription: { text: id } })),
    } }, invocations: [{ executionSuccessful: true }], results: report.checks.filter((check) => check.status === "fail").map((check) => {
      const link = check.capture ? sourceLinks(store, { capture: check.capture })[0] : null;
      return { ruleId: check.rule, ruleIndex: rules.indexOf(check.rule), level: "error", message: { text: check.message },
        locations: link ? [{ physicalLocation: { artifactLocation: { uri: link.file.split("/").map(encodeURIComponent).join("/"), uriBaseId: "%SRCROOT%" }, ...(link.line ? { region: { startLine: link.line } } : {}) } }] : [{ logicalLocations: [{ fullyQualifiedName: check.screen, kind: "resource" }] }],
        properties: { capture: check.capture, sourceRevision: check.capture ? store.getCapture(check.capture).revision : null, derived: check.derived || null, diff: check.diff || null },
      };
    }) }] }, null, 2) + "\n";
  }
  requireThat(format === "markdown", "Use json, junit, sarif, or markdown");
  const lines = [`# ${escapeMarkdown(report.title)}`, "", `CI policy: **${report.passed ? "passed" : "failed"}**. Human acceptance is not assessed.`, "", "| Screen | Check | Result | Details |", "| --- | --- | --- | --- |"];
  for (const check of report.checks) lines.push(`| ${escapeMarkdown(check.title || check.screen)} | ${escapeMarkdown(check.rule)} | ${check.status} | ${escapeMarkdown(check.message)} |`);
  return lines.join("\n") + "\n";
}

export function getReport(store, id) {
  initializeEvidence(store);
  const record = parse(store.db.prepare("SELECT data FROM ci_reports WHERE id=?").get(text(id, "CI report ID")));
  requireThat(record, "CI report not found", 404);
  return record;
}

export async function exportReviewReport(store, input) {
  const run = store.compare(input.run);
  const output = resolve(input.output);
  mkdirSync(output);
  mkdirSync(join(output, "assets"));
  const notes = [], evidence = [], derived = [], sources = [];
  const exportedAssets = new Set();
  for (const id of run.captureIds) {
    const capture = store.getCapture(id);
    const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[capture.mimeType];
    writeFileSync(join(output, "assets", `${id}.${extension}`), await captureBytes(store, id), { flag: "wx" });
    notes.push(...store.getScreen(capture.screen).notes.filter((note) => note.capture === id));
    evidence.push(...store.listEvidence({ capture: id }));
    initializeEvidence(store);
    derived.push(...store.db.prepare("SELECT data FROM derived_evidence WHERE capture=? ORDER BY rowid").all(id).map(parse));
    sources.push(...sourceLinks(store, { capture: id }));
  }
  const lines = [`# ${escapeMarkdown(run.title)}`, "", "Review evidence. Target approval and fix verification remain human decisions.", ""];
  for (const entry of run.entries) {
    lines.push(`## ${escapeMarkdown(entry.title)}`, "", `Variant: ${escapeMarkdown(JSON.stringify(entry.variant))}`, "");
    for (const [role, capture] of Object.entries(entry.captures)) {
      const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[capture.mimeType];
      lines.push(`### ${role}`, "", `![${escapeMarkdown(entry.title)}](assets/${capture.id}.${extension})`, "", `Revision: ${escapeMarkdown(capture.revision)} · Capture: ${capture.id}`, "");
      for (const note of notes.filter((note) => note.capture === capture.id)) lines.push(`- **${escapeMarkdown(note.status)}** ${escapeMarkdown(note.text)}${note.region ? ` — area ${escapeMarkdown(JSON.stringify(note.region))}` : ""}`);
      lines.push("");
    }
    for (const diff of entry.measurements) if (diff.image) {
      writeFileSync(join(output, "assets", `${diff.id}.png`), store.diffImage(diff.id), { flag: "wx" });
      lines.push(`Difference: ${(diff.changedRatio * 100).toFixed(3)}%${diff.region ? " in selected area" : ""}. [Difference map](assets/${diff.id}.png)`, "");
    }
  }
  for (const item of evidence) if (item.artifact) {
    if (!exportedAssets.has(item.artifact.hash)) {
      writeFileSync(join(output, "assets", item.artifact.hash), store.evidenceArtifact(item.id).bytes, { flag: "wx" });
      exportedAssets.add(item.artifact.hash);
    }
  }
  const manifest = { run, notes, evidence, derived, sourceLinks: sources, createdAt: now() };
  writeFileSync(join(output, "report.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  writeFileSync(join(output, "review.md"), lines.join("\n"), { flag: "wx" });
  return { output, markdown: join(output, "review.md"), manifest: join(output, "report.json"), captures: run.captureIds.length, notes: notes.length };
}

const pairSchema = { left: string, right: string };
const sourceSchema = { capture: string, note: string, evidence: string, file: string, symbol: string, line: { type: "integer", minimum: 1 }, revision: string };
const rectangle = object({ x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } }, ["x", "y", "width", "height"]);
const fixtureSchema = object({ name: string, version: string, required: { type: "array", items: string }, equals: anyObject });
const policySchema = object({ pair: { type: "array", items: { enum: ["current", "target", "pr"] }, minItems: 2, maxItems: 2 },
  maxChangedRatio: { type: "number", minimum: 0, maximum: 1 }, maxChangedPixels: { type: "integer", minimum: 0 },
  minSsim: { type: "number", minimum: -1, maximum: 1 }, threshold: { type: "integer", minimum: 0, maximum: 255 },
  masks: { type: "array", items: rectangle }, region: rectangle, failOnMissing: boolean, requireMatchingFixture: boolean,
  fixtureContract: fixtureSchema, maxAccessibilityViolations: { type: "integer", minimum: 0 }, failOnConsoleErrors: boolean,
  failOnNetworkErrors: boolean, requireEvidence: { type: "array", items: string },
});
const action = (description, inputSchema, run, cliOnly = false) => ({ description, inputSchema, run, cliOnly });

export const evidenceActions = {
  ocr_extract: action("Extract English text and normalized word coordinates with the bundled OCR engine and model.", object({ capture: string, language: { enum: ["eng"] }, psm: { type: "integer", enum: ocrModes } }, ["capture"]), extractOcr),
  ocr_search: action("Search recorded OCR and return matching lines with word coordinates.", object({ query: string, project: string, limit: integer, cursor: integer }, ["query"]), searchOcr),
  text_compare: action("Compare recorded OCR for two exact captures without changing either capture.", object({ ...pairSchema, leftOcr: string, rightOcr: string }, ["left", "right"]), compareText),
  derived_get: action("Read an immutable derived evidence record.", object({ id: string }, ["id"]), (store, input) => getDerived(store, input.id)),
  derived_list: action("Read paginated derived evidence for one capture, optionally by kind or query.", object({ capture: string, kind: string, query: string, limit: integer, cursor: integer }, ["capture"]), listDerived),
  source_link: action("Attach a repository-relative file and symbol at the capture revision to feedback or evidence.", object(sourceSchema, ["capture", "file"]), addSourceLink),
  source_links: action("List source links for an exact capture or its note.", object({ capture: string, note: string }, ["capture"]), sourceLinks),
  selector_annotate: action("Create a region note from selector geometry recorded during capture.", object({ capture: string, geometry: string, selector: string, text: string, author: string }, ["capture", "selector", "text"]), addSelectorNote),
  perceptual_compare: action("Measure block SSIM and RGB error at original dimensions. Does not decide acceptance.", object(pairSchema, ["left", "right"]), perceptualComparison),
  fixture_check: action("Check recorded fixture metadata against a contract and optional paired capture.", object({ capture: string, other: string, record: string, contract: fixtureSchema }, ["capture", "contract"]), fixtureContract),
  ci_evaluate: action("Evaluate an explicit CI policy against an immutable run. Returns exitCode without approving evidence.", object({ run: string, jobs: { type: "array", items: string }, policy: policySchema }), evaluateCI),
  ci_report: action("Format a stored CI result as SARIF, JUnit, Markdown, or JSON.", object({ report: string, format: { enum: ["sarif", "junit", "markdown", "json"] } }, ["report", "format"]), (store, input) => ({ format: input.format, content: formatReport(store, getReport(store, input.report), input.format) })),
  report_export: action("Write a stored CI result to a new local report file.", object({ report: string, format: { enum: ["sarif", "junit", "markdown", "json"] }, output: string }, ["report", "format", "output"]), (store, input) => {
    const output = resolve(input.output); writeFileSync(output, formatReport(store, getReport(store, input.report), input.format), { flag: "wx" }); return { output };
  }, true),
  review_report: action("Export a run as a Markdown review report with original captures, comments, measurements, and evidence attachments.", object({ run: string, output: string }, ["run", "output"]), exportReviewReport, true),
};
