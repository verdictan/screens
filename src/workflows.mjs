const feedbackStates = {
  open: { label: "Open", closed: false },
  "in-progress": { label: "In progress", closed: false },
  submitted: { label: "Ready to review", closed: false },
  verified: { label: "Verified", closed: true },
  "wont-fix": { label: "Not planned", closed: true },
};
const jobStates = {
  queued: { label: "Waiting to start", pending: true },
  running: { label: "Capturing screens…", pending: true },
  completed: { label: "Capture complete", pending: false, terminal: true },
  failed: { label: "Capture incomplete", pending: false },
  cancelled: { label: "Capture stopped", pending: false },
};
export const workflows = {
  feedback: {
    owner: "src/store.mjs", initial: "open", states: feedbackStates,
    events: {
      reopen: { from: Object.keys(feedbackStates), to: "open", actors: ["human", "agent"] },
      start: { from: Object.keys(feedbackStates), to: "in-progress", actors: ["human", "agent"] },
      submit: { from: Object.keys(feedbackStates), to: "submitted", actors: ["human", "agent"], requires: ["fresh implementation capture for the same screen and variant", "resolution"] },
      verify: { from: Object.keys(feedbackStates), to: "verified", actors: ["human"], requires: ["fresh implementation capture for the same screen and variant"] },
      decline: { from: Object.keys(feedbackStates), to: "wont-fix", actors: ["human"], requires: ["resolution"] },
    },
    concurrency: "expectedRevision",
  },
  job: {
    owner: "src/automation.mjs", initial: "queued", states: jobStates,
    events: {
      lease: { from: ["queued", "running"], to: "running", actors: ["worker"], guard: "lease-expired-if-running" },
      heartbeat: { from: ["running"], to: "running", actors: ["worker"], guard: "owned-lease" },
      checkpoint: { from: ["running"], to: "running", actors: ["worker"], guard: "owned-lease" },
      complete: { from: ["running"], to: "completed", actors: ["worker"], guard: "owned-lease" },
      fail: { from: ["running"], to: "failed", actors: ["worker"], guard: "owned-lease" },
      cancel: { from: ["queued", "running", "failed", "cancelled"], to: "cancelled", actors: ["human", "agent"] },
      resume: { from: ["queued", "running", "failed", "cancelled"], to: "queued", actors: ["human", "agent"], guard: "lease-expired-if-running", requires: ["unchanged capture inputs"] },
      interrupt: { from: ["running"], to: "queued", actors: ["worker"], guard: "owned-lease" },
    },
    concurrency: "expectedRevision for user actions; token and unexpired lease for workers",
  },
  fixture: {
    owner: "src/fixture-boundaries.mjs", initial: "idle",
    states: { idle: {}, waiting: {}, "setting-up": {}, resetting: {}, active: {}, "tearing-down": {}, failed: {}, closed: { terminal: true } },
    events: {
      wait: { from: ["idle", "tearing-down"], to: "waiting" },
      setup: { from: ["waiting"], to: "setting-up" },
      reset: { from: ["setting-up"], to: "resetting" },
      activate: { from: ["resetting"], to: "active" },
      teardown: { from: ["active", "failed"], to: "tearing-down" },
      fail: { from: ["setting-up", "resetting", "tearing-down"], to: "failed" },
      close: { from: ["idle", "waiting", "failed"], to: "closed" },
    },
    concurrency: "serialized boundary operations; all close callers await the same cleanup",
  },
  plan: {
    owner: "src/workspace.mjs", initial: "editing",
    states: { editing: {}, preparing: {}, blocked: {}, ready: {}, starting: {}, uploading: {}, done: {} },
    events: {
      edit: { from: ["editing", "blocked", "ready", "done"], to: "editing" },
      prepare: { from: ["editing", "blocked", "ready"], to: "preparing" },
      prepared: { from: ["preparing"], to: ["blocked", "ready"] },
      start: { from: ["ready"], to: "starting" },
      upload: { from: ["editing", "blocked", "ready"], to: "uploading" },
      success: { from: ["starting", "uploading"], to: "done" },
      failure: { from: ["preparing", "starting", "uploading"], to: ["editing", "blocked", "ready"] },
    },
    concurrency: "reviewed input fingerprint; one job per prepared plan",
  },
};

export const workflowInventory = [
  ["feedback", "shared", "src/store.mjs", "Open, in progress, submitted, verified or not planned; decisions and evidence stay distinct."],
  ["job", "shared", "src/automation.mjs", "Queue, lease, checkpoint, finish, cancel, interrupt and resume."],
  ["plan", "shared", "src/workspace.mjs", "Edit, prepare, resolve settings and explicitly start; each dialog session retains its project, capture and draft identity."],
  ["review-attention", "derived", "src/workspace.mjs", "Submitted fix, open feedback, proposed design, missing capture or ready; recomputed from records."],
  ["target-approval", "derived", "src/store.mjs", "Missing, proposed or approved for an exact capture and variant; revision-bound human decision."],
  ["task-claim", "derived", "src/automation.mjs", "Unclaimed, held, expired or released; ownership and time are separate from feedback status."],
  ["schedule", "local", "src/automation.mjs", "Disabled, waiting, due, claimed and advanced; revision binds interval and event cursors."],
  ["capture-attempt", "local", "src/auto-capture.mjs", "Plan, prepare, capture, report and clean up; result is captured, partial or failed."],
  ["application-capture", "local", "src/auto-capture.mjs", "Running, captured, partial, failed, empty or not selected."],
  ["readiness", "local", "src/capture-scenarios.mjs", "Unverified, passed or failed; browser readiness is not screenshot creation."],
  ["native-readiness", "local", "src/native-contract.mjs", "Wait for the matching request, screen, fixture and zero pending work; ready, error or timeout."],
  ["authentication", "local", "src/capture-scenarios.mjs", "Create context, authenticate, check readiness, export state and dispose."],
  ["coverage", "local", "src/screen-inventory.mjs", "Unresolved, missing, captured, failed or excluded; readiness and optional confidence remain separate."],
  ["fixture-boundary", "shared", "src/fixture-boundaries.mjs", "Idle, waiting, setting up, resetting, active, tearing down, failed and closed; cleanup remains due after partial setup failure."],
  ["managed-service", "local", "src/capture-environment.mjs", "Dependency wait, launch, readiness, runtime monitoring and shared cleanup; startup status and physical process phase remain distinct."],
  ["resource", "reducer", "ui/lib/api.js", "Idle, loading, ready, refreshing, failed or stale; old requests cannot replace newer results."],
  ["write-request", "local", "ui/lib/api.js", "New, in flight, uncertain, succeeded or rejected; retries retain the idempotency key after uncertain outcomes."],
  ["capture-image", "reducer", "ui/components/CaptureImage.jsx", "Loading, loaded or failed for one image identity; placeholder and delayed loading label are derived."],
  ["area-comparison", "reducer", "ui/Comparison.jsx", "Idle, selecting, selected or comparing; changing capture pairs clears the region."],
  ["annotation-gesture", "reducer", "ui/components/AnnotationLayer.jsx", "Idle, pointer drag or keyboard adjustment, then confirm or cancel; losing pointer capture cancels the unfinished drag."],
  ["pixel-measurement", "local", "ui/Comparison.jsx", "Idle, measuring, measured or failed; results belong to the exact pair, masks, threshold and region."],
  ["feedback-write", "local", "ui/ReviewPanels.jsx", "Compose, submit or fail; reopening waits for Undo and rolls back on failure."],
  ["evidence-form", "local", "ui/ReviewPanels.jsx", "Closed, editing or saving; kind, method and outcome determine required artifact fields."],
  ["review-set-form", "local", "ui/components/ReviewSets.jsx", "Closed, new or editing, saving, failed and saved; server revision owns conflicts."],
  ["navigation", "local", "ui/App.jsx", "Project, session, set, screen and tab selection; library, focus and command visibility are orthogonal."],
  ["command-dispatch", "local", "ui/components/CommandMenu.jsx", "Open, selected, closing, focus restored, then asynchronous action dispatched."],
  ["undo", "local", "ui/lib/undo.jsx", "Waiting, undone or committed; unmount cancels pending actions."],
  ["motion", "local", "ui/lib/motion.js", "Held, moving, interrupted or resting; reduced motion is a rendering preference."],
  ["standard-controls", "library", "ui/components/ui/", "Radix and Vaul own dialog, drawer, tab, toggle and focus transitions."],
  ["measurement-outcome", "immutable", "src/diff.mjs", "Measured or dimension mismatch; pixel evidence does not decide acceptance."],
  ["evidence-outcome", "immutable", "src/evidence-tools.mjs", "Reported pass, fail or not run; CI completion and human acceptance are separate."],
  ["storage-operation", "transactional", "src/storage-tools.mjs", "Prepare assets, write immutable records, commit or roll back; retention follows reachability."],
  ["pagination", "local", "src/automation.mjs", "Start, advance and exhaust a query-bound snapshot cursor."],
  ["server-lifecycle", "local", "src/cli.mjs", "Listen, run workers, receive shutdown, abort workers and close the registry."],
].map(([id, implementation, owner, behavior]) => ({ id, implementation, owner, behavior }));

export function workflowCatalog() { return { version: 1, machines: workflows, inventory: workflowInventory }; }
export function feedbackOpen(note) { return feedbackStates[note.status]?.closed === false; }
export function jobPending(job) { return jobStates[job.status]?.pending === true; }
export function canJobTransition(job, event, { actor = "human", token, time = Date.now() } = {}) {
  const rule = workflows.job.events[event];
  if (!rule?.from.includes(job.status) || !rule.actors.includes(actor)) return false;
  if (rule.guard === "lease-expired-if-running") return job.status !== "running" || Date.parse(job.leaseUntil) <= time;
  if (rule.guard === "owned-lease") return Boolean(token && token === job.token && Date.parse(job.leaseUntil) > time);
  return true;
}
export function jobActions(job, time = Date.now()) {
  return ["cancel", "resume"].filter(event => canJobTransition(job, event, { time }));
}
export function planPhase(plan) {
  if (!plan) return "editing";
  const count = plan.applications ?? plan.configuration?.applications?.length ?? 0;
  return !count || plan.decisions.some(item => item.blocking || item.kind === "environment") ? "blocked" : "ready";
}

export function feedbackTaskWorkflow(note) {
  const nextAction = !feedbackOpen(note) ? { kind: "none", reason: "Feedback is closed" }
    : note.status === "submitted" ? { kind: "wait", reason: "Human review is pending" }
    : { kind: "submit", tool: "reviews_submit_fix", arguments: { id: note.id, expectedRevision: note.revision }, required: ["evidence", "resolution"] };
  return { machine: "feedback", state: note.status, nextAction, acceptance: "human-only" };
}
