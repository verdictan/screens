import { workflows, planPhase } from "../../src/workflows.mjs";

export const initialCaptureFlow = { phase: "editing", plan: null, error: "" };
export function captureFlow(state, event) {
  const rule = workflows.plan.events[event.type];
  if (rule && !rule.from.includes(state.phase)) return state;
  switch (event.type) {
    case "reset": case "edit": return initialCaptureFlow;
    case "prepare": return { phase: "preparing", plan: null, error: "" };
    case "prepared": return { phase: planPhase(event.plan), plan: event.plan, error: "" };
    case "start": return state.phase === "ready" ? { ...state, phase: "starting", error: "" } : state;
    case "upload": return { ...state, phase: "uploading", error: "" };
    case "success": return { ...state, phase: "done", error: "" };
    case "failure": {
      const plan = event.error.status === 409 ? null : state.plan;
      return { phase: planPhase(plan), plan, error: event.error.message };
    }
    default: return state;
  }
}
export function resourceFlow(state, event) {
  switch (event.type) {
    case "load": return { ...state, status: state.data === undefined ? "loading" : "refreshing", error: undefined };
    case "success": return { status: "ready", data: event.data };
    case "failure": return { ...state, status: state.data === undefined ? "failed" : "stale", error: event.error };
    case "cancel": return { ...state, status: state.data === undefined ? "idle" : "ready" };
    default: return state;
  }
}
export function imageFlow(state, event) {
  if (event.type === "reset") return { identity: event.identity, phase: "loading" };
  if (state.identity !== event.identity) return state;
  return { ...state, phase: event.type === "loaded" ? "loaded" : "failed" };
}
export const initialArea = { phase: "idle", selection: null };
export function areaFlow(state, event) {
  switch (event.type) {
    case "reset": case "clear": return initialArea;
    case "select": return { ...state, phase: state.phase === "selecting" ? state.selection ? "selected" : "idle" : "selecting" };
    case "cancel": return { ...state, phase: state.selection ? "selected" : "idle" };
    case "selected": return { phase: "selected", selection: event.selection };
    case "compare": return state.selection ? { ...state, phase: state.phase === "comparing" ? "selected" : "comparing" } : state;
    case "requested": return { phase: event.comparable ? "comparing" : "selected", selection: event.selection };
    default: return state;
  }
}

export function recipeEditor(source) {
  if (!source.trim()) return { phase: "empty", recipe: null };
  let recipe;
  try { recipe = JSON.parse(source); }
  catch { return { phase: "incomplete", recipe: null, message: "Complete the JSON before preparing the plan." }; }
  const record = value => value && typeof value === "object" && !Array.isArray(value);
  const strings = value => value === undefined || Array.isArray(value) && value.every(item => typeof item === "string");
  const structured = record(recipe) && Array.isArray(recipe.applications)
    && recipe.applications.every(app => record(app) && (app.path === undefined || typeof app.path === "string")
      && (app.baseUrl === undefined || typeof app.baseUrl === "string")
      && (app.ready === undefined || typeof app.ready === "string" || record(app.ready) && (app.ready.selector === undefined || typeof app.ready.selector === "string")))
    && strings(recipe.envFiles)
    && (recipe.services === undefined || Array.isArray(recipe.services) && recipe.services.every(service => record(service)
      && (service.name === undefined || typeof service.name === "string")
      && (service.ready === undefined || record(service.ready) && (service.ready.url == null || typeof service.ready.url === "string"))));
  return structured ? { phase: "structured", recipe }
    : { phase: "raw", recipe, message: "Prepare the plan to check this recipe and expand its settings." };
}

export const initialGesture = { phase: "idle", region: null, pointer: null, start: null };
export const selectionRectangle = (start, end) => ({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });
export function annotationGesture(state, event) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  switch (event.type) {
    case "cancel": case "finish": return initialGesture;
    case "pointer-start": return { phase: "dragging", pointer: event.pointer, start: event.point, region: null };
    case "pointer-move": return state.phase === "dragging" && state.pointer === event.pointer
      ? { ...state, region: selectionRectangle(state.start, event.point) } : state;
    case "pointer-cancel": return state.phase === "dragging" && state.pointer === event.pointer ? initialGesture : state;
    case "keyboard-start": return state.phase === "idle" ? { phase: "adjusting", pointer: null, start: null, region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } } : state;
    case "keyboard-move": {
      if (state.phase !== "adjusting") return state;
      const region = state.region;
      return { ...state, region: event.resize
        ? { ...region, width: clamp(region.width + event.dx, 0.01, 1 - region.x), height: clamp(region.height + event.dy, 0.01, 1 - region.y) }
        : { ...region, x: clamp(region.x + event.dx, 0, 1 - region.width), y: clamp(region.y + event.dy, 0, 1 - region.height) } };
    }
    default: return state;
  }
}
