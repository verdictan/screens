import { workflows } from "./workflows.mjs";

export function fixtureBoundaries(definition = {}, context, command) {
  let phase = "idle", currentGroup, cleanupDue = false, lastInput = {}, epoch = 0, failure;
  let pending = Promise.resolve(), closing;
  const events = [], scope = definition.scope || "run";
  if (!["run", "scenario", "group"].includes(scope)) throw Error("Fixture scope must be run, scenario or group");
  const move = event => { phase = workflows.fixture.events[event].to; };
  const enqueue = action => {
    const operation = pending.then(action);
    pending = operation.catch(() => {});
    return operation;
  };
  const run = async (step, input = {}) => {
    const values = { scenario: input.scenario || "run", group: input.group || "default", device: input.variant?.device || "all", baseUrl: input.baseUrl || "" };
    for (const args of definition[step] || []) {
      const resolved = args.map(arg => arg.replace(/\{(scenario|group|device|baseUrl)\}/g, (_, name) => String(values[name])));
      try { await command(resolved, step === "teardown" ? { ...context, signal: undefined } : context); }
      catch (error) { throw Error(`Fixture ${step} failed: ${error.message}`); }
    }
    events.push({ phase: step, scenario: input.scenario, group: input.group, device: input.variant?.device });
  };
  const begin = async input => {
    cleanupDue = true; lastInput = input;
    try {
      move("setup"); await run("setup", input);
      move("reset"); await run("reset", input);
      epoch++; failure = null; move("activate");
    } catch (error) { failure = error; move("fail"); throw error; }
  };
  const end = async () => {
    if (!cleanupDue) return;
    move("teardown");
    try { await run("teardown", lastInput); cleanupDue = false; failure = null; move("wait"); }
    catch (error) { failure = error; move("fail"); throw error; }
  };
  const start = async input => {
    if (phase === "closed") throw Error("Fixture boundary is closed");
    if (phase === "failed" && scope === "run") throw failure;
    if (phase !== "idle") return;
    move("wait");
    if (scope === "run") await begin(input);
  };
  return {
    definition, events, get epoch() { return epoch; }, get phase() { return phase; },
    start(input = {}) { return enqueue(() => start(input)); },
    enter(input) {
      return enqueue(async () => {
        await start(input);
        const group = JSON.stringify([input.application, input.variant, input.group || input.scenario]);
        if (scope === "scenario" || scope === "group" && (currentGroup !== group || phase === "failed")) { await end(); await begin(input); }
        currentGroup = group;
      });
    },
    reusable(recipe) {
      if (scope === "group" || scope === "run" && (definition.setup?.length || definition.reset?.length)) return false;
      return scope === "scenario" && Boolean(definition.reset?.length) || definition.independent === true || recipe.readOnly === true;
    },
    close() {
      closing ||= enqueue(async () => { try { await end(); } finally { move("close"); } });
      return closing;
    },
  };
}
