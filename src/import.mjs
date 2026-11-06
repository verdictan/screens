import { readFileSync, realpathSync, existsSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { requireThat, text } from "./validation.mjs";

function localImage(base, file) {
  requireThat(
    typeof file === "string" && !/^https?:/.test(file),
    "Capture imports require local files",
  );
  const root = realpathSync(base),
    path = realpathSync(resolve(base, file));
  const rel = relative(root, path);
  requireThat(
    rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel),
    "Capture is outside the manifest directory; copy assets beside the manifest",
  );
  return readFileSync(path);
}

export function discover(projectPath) {
  const root = resolve(projectPath);
  const candidates = [
    "screens.json",
    "docs/picks/manifest.json",
    ".artifacts/ui-review/manifest.json",
    "docs/routing-comparison/manifest.json",
  ];
  return candidates.map((p) => resolve(root, p)).filter(existsSync);
}

export function importManifest(store, filename, options = {}) {
  const path = resolve(filename),
    base = dirname(path),
    data = JSON.parse(readFileSync(path, "utf8"));
  const project = store.project({
    id: options.project || data.project?.id || data.package || "imported",
    name:
      options.name || data.project?.name || data.package || "Imported screens",
    repository: data.project?.repository,
  });
  const captureIds = [],
    warnings = [];
  let importedScreens = 0;
  function add(entry, captures) {
    const screen = store.screen({ project: project.id, ...entry });
    importedScreens++;
    for (const c of captures) {
      if (!c.file) continue;
      let bytes;
      try {
        bytes = localImage(base, c.file);
      } catch (e) {
        warnings.push(
          `${entry.key}: ${c.role} unavailable (${e.code || e.message})`,
        );
        continue;
      }
      const capture = store.capture({
        screen: screen.id,
        ...c,
        bytes,
        revision: c.revision || options.revision || "unknown",
        fixture: c.fixture || options.fixture || "unspecified",
        provenance:
          c.provenance ||
          "Imported capture; source build not independently verified",
      });
      captureIds.push(capture.id);
    }
  }
  if (data.schemaVersion === 1 && Array.isArray(data.screens)) {
    for (const s of data.screens) {
      requireThat(
        Array.isArray(s.captures),
        "Each screen needs captures (an empty array is allowed)",
      );
      add(
        {
          key: s.key,
          title: s.title,
          state: s.state,
          group: s.group,
          route: s.route,
          source: s.source,
          recipe: s.recipe,
        },
        s.captures,
      );
    }
  } else if (data.devices && data.rounds) {
    for (const [device, info] of Object.entries(data.devices))
      for (const g of info.groups)
        for (const s of g.screens) {
          const captures = [
            { role: "target", file: `${device}/should/${s.id}.jpg` },
            ...(s.have
              ? [{ role: "current", file: `${device}/have/${s.id}.jpg` }]
              : []),
          ];
          add(
            {
              key: `${device}/${s.id}`,
              title: s.title,
              group: g.name,
              state: s.id,
            },
            captures.map((c) => ({
              ...c,
              variant: { device },
              fixture: "legacy-picks-unspecified",
              provenance: `Kalkidan picks round ${data.current}; historical build metadata unavailable`,
            })),
          );
        }
    warnings.push(
      "Imported targets are proposals, not approvals. Legacy revisions, viewport, and fixture fidelity require verification. Existing review.json annotations are not migrated.",
    );
  } else if (Array.isArray(data.pages)) {
    const slug = (p) =>
      `${p.canonical === false ? "state/" : ""}${p.id || createHash("sha256").update(p.route).digest("hex").slice(0, 16)}`;
    for (const s of [
      ...data.pages,
      ...(data.states || []).map((s) => ({ ...s, canonical: false })),
    ]) {
      add(
        {
          key: slug(s),
          title: s.title || s.route,
          route: s.route,
          source: s.source,
          state: s.state || "default",
        },
        [
          ["desktop", "pr", "desktop"],
          ["mobile", "pr", "phone"],
          ["beforeDesktop", "current", "desktop"],
          ["beforeMobile", "current", "phone"],
        ]
          .filter(([field]) => s[field])
          .map(([field, role, device]) => ({
            role,
            file: s[field],
            variant: { device },
            provenance: data.mode || "Imported Verdictan review capture",
          })),
      );
    }
  } else if (Array.isArray(data)) {
    for (const s of data) {
      const k = createHash("sha256")
        .update(`${s.route}|${s.state}`)
        .digest("hex")
        .slice(0, 16);
      add(
        {
          key: k,
          title: s.page,
          state: s.state,
          route: s.route,
          source: s.template_or_story,
        },
        [1440, 390].flatMap((width) =>
          ["current", "target", "after"]
            .filter((role) => s[`${role}_${width}`])
            .map((role) => ({
              role: role === "after" ? "pr" : role,
              file: s[`${role}_${width}`],
              variant: {
                device: width === 390 ? "phone" : "desktop",
                viewport: String(width),
              },
              provenance: s.notes || "Imported routing comparison",
            })),
        ),
      );
    }
  } else
    throw new Error(
      "Unsupported manifest. Use screens.json, Kalkidan picks, Verdictan capture manifest or routing comparison.",
    );
  if (!captureIds.length)
    return { project, importedScreens, warnings, run: null };
  const run = store.run({
    project: project.id,
    title:
      options.title ||
      data.title ||
      `Import · ${new Date().toISOString().slice(0, 10)}`,
    captureIds,
    warnings,
    source: {
      kind: "import",
      manifestHash: createHash("sha256")
        .update(readFileSync(path))
        .digest("hex"),
    },
  });
  return { project, importedScreens, warnings, run };
}

export function combineRuns(
  store,
  { project, current, target, pr, title, source = null },
) {
  const ids = [];
  for (const [role, id] of Object.entries({ current, target, pr })) {
    if (!id) continue;
    const run = store.getRun(id);
    requireThat(
      run.project === project,
      "Comparison runs must belong to the same project",
    );
    const groups = new Map();
    for (const captureId of run.captureIds) {
      const c = store.getCapture(captureId),
        k = `${c.screen}|${JSON.stringify(c.variant)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    for (const captures of groups.values()) {
      const chosen =
        captures.find((c) => c.role === role) ||
        (captures.length === 1 ? captures[0] : null);
      requireThat(
        chosen,
        `Run ${id} has multiple candidates and no ${role} capture`,
      );
      ids.push(
        store.capture({ ...chosen, role, bytes: store.image(chosen.id).bytes })
          .id,
      );
    }
  }
  return store.run({
    project,
    title: text(title || "Comparison", "title"),
    captureIds: ids,
    source,
  });
}
