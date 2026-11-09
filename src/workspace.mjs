import { feedbackOpen, jobPending, jobActions, planPhase } from "./workflows.mjs";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { environmentAt } from "./capture-environment.mjs";
import { detectProject } from "./discovery.mjs";
import { join, resolve } from "node:path";
import { automaticInput, draftAutomaticPlan, configurationDecisions } from "./automatic-plan.mjs";
import { expandCaptureConfig } from "./capture-recipe.mjs";
import { automationActions } from "./automation.mjs";
import { captureSummary } from "./capture-summary.mjs";
import { choice, requireThat, text } from "./validation.mjs";

export function captureProblems(run) {
  const coverage = run.source?.coverage;
  const scenarios = (coverage?.requirements || []).filter(item => item.required && item.status !== "excluded" && (item.status !== "captured" || item.readiness?.status !== "passed"))
    .map(item => ({ key: item.name || item.title || item.id, variant: item.variant || {}, readiness: { status: "failed", reason: item.reason || item.readiness?.reason || "Unverified readiness" } }));
  return captureSummary({ scenarios, applications: [{ path: "Capture session", issues: [...new Set(run.warnings || [])] }] }).groups;
}

export function projectWorkspace(store, project) {
  const jobs = automationActions["jobs-list"].run(store, {}).filter(job => !project || job.config.project.id === project);
  const sessions = project ? store.runs(project) : [];
  const rows = [];
  for (const screen of project ? store.search({ project }) : []) {
    const detail = store.getScreen(screen.id), groups = new Map();
    for (const capture of detail.captures) {
      const key = JSON.stringify(capture.variant);
      if (!groups.has(key)) groups.set(key, { screen: screen.id, title: screen.title, variant: capture.variant, captures: {} });
      const row = groups.get(key);
      row.captures[capture.role] ||= capture;
    }
    if (!groups.size) rows.push({ screen: screen.id, title: screen.title, status: "missing", label: "Capture this screen", captureIds: [] });
    for (const [key, row] of groups) {
      const ids = new Set(detail.captures.filter(capture => JSON.stringify(capture.variant) === key).map(capture => capture.id));
      const notes = detail.notes.filter(note => ids.has(note.capture) && feedbackOpen(note));
      row.status = notes.some(note => note.status === "submitted") ? "submitted" : notes.length ? "feedback" : row.captures.target && !detail.targets.some(target => target.capture === row.captures.target.id) ? "design" : !row.captures.current ? "missing" : "ready";
      row.label = { submitted: "Review the fix", feedback: `${notes.length} open ${notes.length === 1 ? "comment" : "comments"}`, design: "Approve the design reference", missing: "Capture the current screen", ready: "Ready to review" }[row.status];
      row.captureIds = Object.values(row.captures).map(capture => capture.id);
      row.run = sessions.find(session => row.captureIds.every(id => session.captureIds.includes(id)))?.id || null;
      rows.push(row);
    }
  }
  const order = ["submitted", "feedback", "design", "missing", "ready"];
  rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.title.localeCompare(b.title));
  const latest = sessions.find(session => session.source?.kind !== "workspace");
  const latestJob = jobs[0];
  const problems = latestJob && (!latest || latestJob.result === latest.id || latestJob.updatedAt > latest.createdAt)
    ? latestJob.report?.summary.groups || (latestJob.error ? captureSummary({ error: latestJob.error }).groups : latest ? captureProblems(latest) : [])
    : latest ? captureProblems(latest) : [];
  return { rows, folder: jobs.find(job => job.kind === "automatic")?.auto.options.path || "", problems,
    jobs: [...jobs].sort((a, b) => Number(jobPending(b)) - Number(jobPending(a))).slice(0, 20).map(job => ({ id: job.id, title: job.title, status: job.status, availableActions: jobActions(job), revision: job.revision, result: job.result, error: job.error, images: (job.captures || []).length, summary: job.report?.summary, createdAt: job.createdAt })) };
}

export function openWorkspace(store, input) {
  const workspace = projectWorkspace(store, input.project);
  const captureIds = [...new Set(workspace.rows.flatMap(row => row.captureIds))];
  requireThat(captureIds.length, "Capture this project before opening its review");
  const previous = store.runs(input.project);
  return previous.find(run => run.captureIds.length === captureIds.length && captureIds.every(id => run.captureIds.includes(id))) || store.run({ project: input.project, title: "Project review", captureIds, source: { ...previous.find(run => run.source?.kind !== "workspace")?.source, kind: "workspace" }, warnings: previous.find(run => run.source?.kind !== "workspace")?.warnings || [] });
}

export function captureWorkspace(store) {
  const plans = new Map();
  return {
    prepare(input) {
      try {
        const path = text(input.path, "project folder", 4000), draft = draftAutomaticPlan(path, { project: input.project });
        const file = join(path, "screens.capture.json");
        const recipe = input.recipe !== undefined ? input.recipe : (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : draft.configuration);
        const configuration = expandCaptureConfig(recipe);
        configuration.project = { ...draft.configuration.project, ...configuration.project, ...(input.project ? { id: input.project } : {}) };
        const detection = detectProject(path);
        const decisions = configurationDecisions(configuration, detection, draft.decisions);
        let rootValues;
        try { rootValues = { ...environmentAt(detection.root, configuration.envFiles), ...process.env, ...configuration.env }; }
        catch (error) { rootValues = { ...process.env, ...configuration.env }; decisions.push({ blocking: true, question: error.message }); }
        for (const app of configuration.applications) {
          let values;
          try { values = { ...rootValues, ...environmentAt(resolve(detection.root, app.path), app.envFiles), ...process.env, ...configuration.env, ...app.env }; }
          catch (error) { decisions.push({ blocking: true, question: error.message, application: app.path }); continue; }
          const names = new Set([...(configuration.requiredEnv || []), ...(app.requiredEnv || []), ...detection.assets.environment.filter(item => item.application === app.path && item.required).map(item => item.name)]);
          for (const name of names) if (!(app.optionalEnv || []).includes(name) && !String(values[name] ?? "").trim() && !decisions.some(item => item.name === name && item.application === app.path)) decisions.push({ kind: "environment", name, application: app.path, question: `Supply ${name} through the environment or envFiles` });
        }
        for (const service of configuration.services || []) for (const name of service.requiredEnv || []) if (!String(({ ...rootValues, ...service.env })[name] ?? "").trim()) decisions.push({ kind: "environment", name, service: service.name, question: `Supply ${name} for ${service.name} through the environment or envFiles` });
        const prepared = decisions.some(item => item.blocking) ? { root: detection.root, detection, inputHash: null } : automaticInput(path, { recipe: configuration });
        const commands = [
          ...(configuration.setup || []).map(command => ({ location: ".", command })),
          ...(configuration.services || []).flatMap(service => [...(service.prepare || []), ...(service.command ? [service.command] : [])].map(command => ({ location: service.cwd || ".", command }))),
          ...configuration.applications.flatMap(app => [...(app.prepare || []), ...(app.serve ? [app.serve] : []), ...(app.command ? [app.command] : [])].map(command => ({ location: app.path, command }))),
          ...configuration.applications.filter(app => app.adapter === "browser" && !app.serve && !app.baseUrl).flatMap(app => {
            const recipes = prepared.detection.recipes.filter(recipe => recipe.path === app.path);
            const recipe = recipes.find(item => item.name === "dev") || recipes.find(item => item.name === "start");
            return recipe ? [{ location: app.path, command: ["npm", "run", recipe.name], detected: true }] : [];
          }),
        ];
        const role = choice(input.role || "current", ["current", "target", "pr"], "capture purpose");
        if (input.review) requireThat(store.getRun(input.review).project === configuration.project.id, "Capture session belongs to another project");
        const id = randomUUID();
        plans.set(id, { path: prepared.root, recipe: configuration, project: configuration.project?.id, role, review: input.review, inputHash: prepared.inputHash, decisions });
        return { id, state: planPhase({ configuration, decisions }), path: prepared.root, configuration, commands, decisions, choices: draft.choices, applications: configuration.applications.length, scenarios: configuration.applications.reduce((count, app) => count + (app.scenarios?.length || 0), 0), warnings: draft.discovery.warnings };
      } catch (error) { error.status ||= 400; throw error; }
    },
    start(input, requestKey) {
      const result = store.once(requestKey, "workspace.capture", input, () => {
        const plan = plans.get(input.plan);
        requireThat(plan, "Prepare the capture plan again before starting", 409);
        if (plan.job) return automationActions["jobs-get"].run(store, { id: plan.job });
        requireThat(planPhase({ configuration: plan.recipe, decisions: plan.decisions }) === "ready", "Resolve the missing capture settings before starting");
        const prepared = automaticInput(plan.path, { recipe: plan.recipe });
        requireThat(prepared.inputHash === plan.inputHash, "Project inputs changed. Prepare the capture plan again", 409);
        store.project({ id: plan.project, name: plan.recipe.project?.name || plan.project });
        return automationActions["jobs-enqueue-auto"].run(store, { path: plan.path, recipe: plan.recipe, project: plan.project, role: plan.role, review: plan.review, execute: "yes" });
      });
      const plan = plans.get(input.plan);
      if (plan) plan.job = result.id;
      return result;
    },
  };
}
