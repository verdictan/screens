import { automationActions } from "./automation.mjs";
import { captureActions } from "./capture-tools.mjs";
import { evidenceActions } from "./evidence-tools.mjs";
import { storageActions } from "./storage-tools.mjs";
import { requireThat } from "./validation.mjs";

export const headlessActions = { ...automationActions, ...captureActions, ...evidenceActions, ...storageActions };
export function actionCatalog(cli = false) {
  return Object.entries(headlessActions).filter(([, action]) => cli || !action.cliOnly)
    .map(([name, { description, inputSchema, cliOnly }]) => ({ name, description, inputSchema, cliOnly: Boolean(cliOnly) }));
}
export async function runHeadless(store, name, input = {}, context = {}) {
  const action = headlessActions[name];
  requireThat(action, `Unknown action: ${name}`, 404);
  requireThat(!action.cliOnly || context.cli, "This action requires the local CLI", 403);
  requireThat(input && typeof input === "object" && !Array.isArray(input), "Use an input object");
  requireThat(action.inputSchema.required.every((key) => input[key] !== undefined), `Required fields: ${action.inputSchema.required.join(", ")}`);
  requireThat(Object.keys(input).every((key) => Object.hasOwn(action.inputSchema.properties, key)), "Unknown action input field");
  const result = await action.run(store, input, { ...context, onEvent: context.onEvent || context.emit, runAction: (next, args, options = {}) => runHeadless(store, next, args, { ...context, ...options }) });
  return result;
}
