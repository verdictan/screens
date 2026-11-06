const $ = (id) => document.getElementById(id);
const labels = {
  current: "What it is",
  target: "What it should be",
  pr: "PR result",
};
const state = {
  project: null,
  runs: [],
  run: null,
  entry: null,
  detail: null,
  pair: ["current", "target"],
  point: null,
  loading: 0,
};
const h = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (v !== null && v !== undefined && v !== false)
      e.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat())
    if (child !== null && child !== undefined)
      e.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return e;
};
async function api(path, body) {
  const res = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
let toastTimer;
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 7000);
}
const attempt =
  (fn) =>
  async (...a) => {
    try {
      await fn(...a);
    } catch (e) {
      toast(e.message);
    }
  };
const entryKey = (e) => `${e.screen}|${JSON.stringify(e.variant)}`;
function entries() {
  const q = $("search").value.toLowerCase();
  return (state.run?.entries || [])
    .filter((e) =>
      `${e.title} ${e.screen} ${e.variant.device}`.toLowerCase().includes(q),
    )
    .filter(
      (e) =>
        $("filter").value === "all" ||
        ($("filter").value === "open"
          ? e.openNotes > 0
          : state.pair.some((r) => !e.captures[r])),
    );
}
function updateUrl() {
  const u = new URL(location);
  u.searchParams.set("project", state.project);
  if (state.run) u.searchParams.set("run", state.run.id);
  if (state.entry) u.hash = encodeURIComponent(entryKey(state.entry));
  history.replaceState(null, "", u);
}
async function loadProject(project, runId) {
  state.project = project;
  state.runs = await api(`/api/runs?project=${encodeURIComponent(project)}`);
  $("run").replaceChildren(
    ...state.runs.map((r) => h("option", { value: r.id }, r.title)),
  );
  if (!state.runs.length) {
    state.run = null;
    state.entry = null;
    $("empty").hidden = false;
    $("review").hidden = true;
    $("screens").replaceChildren();
    $("count").textContent = "0";
    return;
  }
  const run = state.runs.find((r) => r.id === runId) || state.runs[0];
  $("run").value = run.id;
  await loadRun(run.id);
}
async function loadRun(id) {
  state.run = await api(`/api/compare?run=${encodeURIComponent(id)}`);
  const desired = decodeURIComponent(location.hash.slice(1));
  const entry =
    state.run.entries.find((e) => entryKey(e) === desired) ||
    state.run.entries[0];
  if (!entry) return;
  state.pair = entry.captures.pr
    ? entry.captures.target
      ? ["target", "pr"]
      : ["current", "pr"]
    : ["current", "target"];
  $("empty").hidden = true;
  $("review").hidden = false;
  await selectEntry(entry);
}
function renderNav() {
  const list = entries();
  $("count").textContent = `${list.length} / ${state.run?.entries.length || 0}`;
  const nodes = [];
  let group = "";
  for (const e of list) {
    if (group !== e.group) {
      group = e.group;
      nodes.push(h("h3", {}, group));
    }
    nodes.push(
      h(
        "button",
        {
          class: "screen-link",
          "aria-current": String(
            state.entry && entryKey(e) === entryKey(state.entry),
          ),
          onclick: attempt(() => selectEntry(e)),
        },
        e.title,
        h(
          "small",
          {},
          `${e.variant.device} · ${e.state}${e.openNotes ? ` · ${e.openNotes} open` : ""}`,
        ),
      ),
    );
  }
  if (!list.length)
    nodes.push(h("p", { class: "muted" }, "No screens match these filters."));
  $("screens").replaceChildren(...nodes);
  const index = list.findIndex((e) => entryKey(e) === entryKey(state.entry));
  $("previous").disabled = index <= 0;
  $("next").disabled = index < 0 || index === list.length - 1;
}
async function selectEntry(entry) {
  const ticket = ++state.loading;
  state.entry = entry;
  state.point = null;
  renderNav();
  updateUrl();
  const detail = await api(
    `/api/screen?id=${encodeURIComponent(entry.screen)}`,
  );
  if (ticket !== state.loading) return;
  state.detail = detail;
  render();
}
function captureNotes(c) {
  return state.detail.notes.filter((n) => n.capture === c.id);
}
function panel(role) {
  const c = state.entry.captures[role];
  if (!c)
    return h(
      "section",
      { class: "capture-panel" },
      h("div", { class: "capture-label" }, h("strong", {}, labels[role])),
      h(
        "div",
        { class: "missing" },
        `No ${role} capture in this run. Missing evidence does not imply a match.`,
      ),
    );
  const wrap = h(
    "div",
    { class: "image-wrap" },
    h("img", {
      src: c.url,
      alt: `${state.entry.title} — ${labels[role]}`,
      onload: () => validateOverlay(),
      onclick: (event) => {
        const rect = event.target.getBoundingClientRect();
        state.point = {
          x: (event.clientX - rect.left) / rect.width,
          y: (event.clientY - rect.top) / rect.height,
        };
        $("note-capture").value = c.id;
        renderPinLabel();
        $("note-text").focus();
      },
    }),
  );
  captureNotes(c)
    .filter((n) => n.point)
    .forEach((n, i) =>
      wrap.append(
        h(
          "button",
          {
            class: "pin",
            style: `left:${n.point.x * 100}%;top:${n.point.y * 100}%`,
            "aria-label": n.text,
            title: n.text,
            onclick: () =>
              document
                .getElementById(`note-${n.id}`)
                ?.scrollIntoView({ block: "center", behavior: "smooth" }),
          },
          i + 1,
        ),
      ),
    );
  return h(
    "section",
    { class: "capture-panel" },
    h(
      "div",
      { class: "capture-label" },
      h("strong", {}, labels[role]),
      h(
        "span",
        {},
        role === "target"
          ? state.entry.targetApproval
            ? "Approved revision"
            : "Proposed target"
          : c.revision === "unknown"
            ? "Revision unknown"
            : c.revision.slice(0, 12),
      ),
    ),
    h("div", { class: "canvas" }, wrap),
    h(
      "div",
      { class: "capture-meta" },
      `${c.variant.device} · ${c.variant.theme} · ${c.variant.viewport}`,
      h("br"),
      `${c.fixture} · ${c.createdAt.slice(0, 10)}`,
    ),
  );
}
function validateOverlay() {
  const images = [...$("comparison").querySelectorAll("img")];
  if (
    $("view").value !== "overlay" ||
    images.length !== 2 ||
    images.some((i) => !i.complete || !i.naturalWidth)
  )
    return;
  if (
    images[0].naturalWidth !== images[1].naturalWidth ||
    images[0].naturalHeight !== images[1].naturalHeight
  ) {
    $("view").value = "side";
    renderComparison();
    toast(
      "Overlay requires captures with equal pixel dimensions. Showing side by side.",
    );
  }
}
function renderComparison() {
  const [a, b] = state.pair,
    ca = state.entry.captures[a],
    cb = state.entry.captures[b];
  const overlay = $("view").value === "overlay" && ca && cb;
  $("opacity-label").hidden = !overlay;
  $("comparison").className = overlay ? "comparison overlay" : "comparison";
  if (overlay) {
    const bottom = h("img", {
      src: ca.url,
      alt: labels[a],
      onload: validateOverlay,
    });
    const top = h("img", {
      src: cb.url,
      alt: labels[b],
      class: "overlay-top",
      style: `opacity:${Number($("opacity").value) / 100}`,
      onload: validateOverlay,
    });
    $("comparison").replaceChildren(
      h("div", { class: "overlay-stage" }, bottom, top),
    );
  } else $("comparison").replaceChildren(panel(a), panel(b));
  $("comparison-status").textContent =
    !ca || !cb
      ? "Comparison incomplete · a capture is missing."
      : ca.hash === cb.hash
        ? "The two captures have identical file bytes."
        : !state.entry.compatible
          ? "Fixture mismatch · compare with caution."
          : "Visual review required · no automatic match verdict.";
  for (const btn of document.querySelectorAll("[data-pair]"))
    btn.setAttribute(
      "aria-pressed",
      String(btn.dataset.pair === state.pair.join(",")),
    );
}
function renderPinLabel() {
  $("pin-label").textContent = state.point
    ? `Pin at ${Math.round(state.point.x * 100)}%, ${Math.round(state.point.y * 100)}%`
    : "No pin selected";
}
function renderNotes() {
  const visible = new Set(Object.values(state.entry.captures).map((c) => c.id));
  const sameVariant = state.detail.captures.filter(
    (c) => JSON.stringify(c.variant) === JSON.stringify(state.entry.variant),
  );
  const ids = new Set(sameVariant.map((c) => c.id));
  const notes = state.detail.notes.filter((n) => ids.has(n.capture));
  $("notes").replaceChildren(
    ...notes.map((n) => {
      const actions = h(
        "div",
        { class: "note-actions" },
        h(
          "a",
          {
            href: `/api/captures/${n.capture}/image`,
            target: "_blank",
            rel: "noopener",
          },
          visible.has(n.capture)
            ? "Open annotated capture"
            : "Open original capture · earlier evidence",
        ),
      );
      const change = (status) =>
        attempt(async () => {
          await api("/api/notes/update", {
            id: n.id,
            expectedRevision: n.revision,
            status,
          });
          await refresh();
          toast("Feedback updated.");
        });
      if (n.status === "submitted")
        actions.append(
          h("button", { onclick: change("verified") }, "Verify fix"),
        );
      if (n.status !== "open")
        actions.append(h("button", { onclick: change("open") }, "Reopen"));
      if (n.evidence)
        actions.append(
          h(
            "a",
            {
              href: `/api/captures/${n.evidence}/image`,
              target: "_blank",
              rel: "noopener",
            },
            "View submitted evidence",
          ),
        );
      return h(
        "article",
        { class: "note", id: `note-${n.id}` },
        h(
          "div",
          { class: "note-head" },
          h(
            "span",
            { class: "muted" },
            `${n.author} · ${new Date(n.createdAt).toLocaleString()}`,
          ),
          h("span", { class: "status" }, n.status),
        ),
        h("p", {}, n.text),
        n.resolution
          ? h("p", { class: "muted" }, `Resolution: ${n.resolution}`)
          : null,
        actions,
      );
    }),
  );
  if (!notes.length)
    $("notes").append(
      h(
        "p",
        { class: "muted" },
        "No feedback yet. This screen has not been approved by default.",
      ),
    );
}
function render() {
  const e = state.entry;
  $("screen-key").textContent = `${state.project} / ${e.state}`;
  $("title").textContent = e.title;
  $("variant").textContent =
    `${e.variant.device} · ${e.variant.theme} · ${e.variant.viewport} · ${e.variant.locale}`;
  $("warnings").replaceChildren(
    ...state.run.warnings.map((w) => h("p", {}, w)),
  );
  $("warnings").hidden = !state.run.warnings.length;
  $("note-capture").replaceChildren(
    ...Object.entries(e.captures).map(([role, c]) =>
      h("option", { value: c.id }, labels[role]),
    ),
  );
  $("approve").hidden = !e.captures.target || !!e.targetApproval;
  renderComparison();
  renderPinLabel();
  renderNotes();
  $("history").replaceChildren(
    ...state.detail.captures.map((c) =>
      h(
        "div",
        { class: "history-row" },
        h(
          "a",
          { href: c.url, target: "_blank", rel: "noopener" },
          `${labels[c.role]} · ${c.variant.device} · ${c.createdAt}`,
        ),
        h("p", {}, `Revision: ${c.revision} · Fixture: ${c.fixture}`),
        h("p", {}, c.provenance),
        h("small", {}, `SHA-256: ${c.hash}`),
      ),
    ),
  );
}
async function refresh() {
  const key = entryKey(state.entry);
  state.run = await api(`/api/compare?run=${state.run.id}`);
  await selectEntry(state.run.entries.find((e) => entryKey(e) === key));
}
$("project").onchange = attempt(() => loadProject($("project").value));
$("run").onchange = attempt(() => loadRun($("run").value));
for (const id of ["search", "filter"])
  $(id).addEventListener("input", renderNav);
for (const button of document.querySelectorAll("[data-pair]"))
  button.onclick = () => {
    state.pair = button.dataset.pair.split(",");
    renderComparison();
    renderNav();
  };
$("view").onchange = renderComparison;
$("opacity").oninput = () => {
  const top = $("comparison").querySelector(".overlay-top");
  if (top) top.style.opacity = Number($("opacity").value) / 100;
};
$("clear-pin").onclick = () => {
  state.point = null;
  renderPinLabel();
};
$("note-capture").onchange = () => {
  state.point = null;
  renderPinLabel();
};
for (const [id, direction] of [
  ["previous", -1],
  ["next", 1],
])
  $(id).onclick = attempt(() => {
    const list = entries(),
      index = list.findIndex((e) => entryKey(e) === entryKey(state.entry));
    if (list[index + direction]) return selectEntry(list[index + direction]);
  });
$("note-form").onsubmit = attempt(async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api("/api/notes", {
      capture: $("note-capture").value,
      text: $("note-text").value,
      author: $("author").value,
      point: state.point,
    });
    $("note-text").value = "";
    await refresh();
    toast("Feedback saved to the registry.");
  } finally {
    button.disabled = false;
  }
});
$("approve").onclick = attempt(async () => {
  const c = state.entry.captures.target;
  const prior = state.detail.targets.find((t) =>
    state.detail.captures.some(
      (x) =>
        x.id === t.capture &&
        JSON.stringify(x.variant) === JSON.stringify(c.variant),
    ),
  );
  await api("/api/targets/approve", {
    capture: c.id,
    expectedRevision: prior?.revision ?? 0,
  });
  await refresh();
  toast("This exact target revision is approved.");
});
document.addEventListener("keydown", (event) => {
  if (event.target.closest("input,textarea,select,button")) return;
  if (event.key === "ArrowLeft" && !$("previous").disabled)
    $("previous").click();
  if (event.key === "ArrowRight" && !$("next").disabled) $("next").click();
});
await attempt(async () => {
  const projects = await api("/api/projects");
  $("connection").textContent = "Registry connected";
  $("project").replaceChildren(
    ...projects.map((p) => h("option", { value: p.id }, p.name)),
  );
  if (!projects.length) return;
  const params = new URLSearchParams(location.search),
    project =
      projects.find((p) => p.id === params.get("project")) || projects[0];
  $("project").value = project.id;
  await loadProject(project.id, params.get("run"));
})();
