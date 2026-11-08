export function fixtureBoundaries(definition = {}, context, command) {
  let started = false, closed = false, currentGroup, active = false, lastInput = {}, epoch = 0;
  const events = [], scope = definition.scope || "run";
  if (!["run", "scenario", "group"].includes(scope)) throw Error("Fixture scope must be run, scenario or group");
  const run = async (phase, input = {}) => {
    const values = { scenario: input.scenario || "run", group: input.group || "default", device: input.variant?.device || "all", baseUrl: input.baseUrl || "" };
    for (const args of definition[phase] || []) {
      const resolved = args.map(arg => arg.replace(/\{(scenario|group|device|baseUrl)\}/g, (_, name) => String(values[name])));
      try { await command(resolved, phase === "teardown" ? { ...context, signal: undefined } : context); }
      catch (error) { throw Error(`Fixture ${phase} failed: ${error.message}`); }
    }
    events.push({ phase, scenario: input.scenario, group: input.group, device: input.variant?.device });
  };
  const begin = async input => { active = true; lastInput = input; await run("setup", input); await run("reset", input); epoch++; };
  const end = async () => { if (!active) return; active = false; await run("teardown", lastInput); };
  return {
    definition, events, get epoch() { return epoch; },
    async start(input = {}) { if (started) return; started = true; if (scope === "run") await begin(input); },
    async enter(input) {
      await this.start(input);
      const group = JSON.stringify([input.application, input.variant, input.group || input.scenario]);
      if (scope === "scenario" || scope === "group" && currentGroup !== group) { await end(); await begin(input); }
      currentGroup = group;
    },
    reusable(recipe) {
      if (scope === "group" || scope === "run" && (definition.setup?.length || definition.reset?.length)) return false;
      return scope === "scenario" && Boolean(definition.reset?.length) || definition.independent === true || recipe.readOnly === true;
    },
    async close() { if (closed || !started) return; closed = true; await end(); },
  };
}
