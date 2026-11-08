import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { requireThat, text, choice } from "./validation.mjs";
import { gitOutput } from "./runtime.mjs";
import { captureConfig } from "./capture-recipe.mjs";
import { executeCaptureRecipe } from "./auto-capture.mjs";
import { automaticInput } from "./automatic-plan.mjs";
import { command } from "./capture-process.mjs";
import { combineRuns } from "./import.mjs";

export function resolveRevision(repo, ref) {
  return gitOutput(repo, ["rev-parse", "--verify", "--end-of-options", `${text(ref, "Git ref")}^{commit}`]);
}
export async function resolvePullRequest(repository, number) {
  requireThat(/^[\w.-]+\/[\w.-]+$/.test(repository) && /^[1-9]\d*$/.test(String(number)), "Use OWNER/REPO and a PR number");
  const request = async (path) => {
    const token = process.env.GITHUB_TOKEN;
    const response = await fetch(`https://api.github.com/${path}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "verdictan-screens", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(30000),
    });
    const value = await response.json();
    requireThat(response.ok, value.message || `GitHub returned ${response.status}`, response.status);
    return value;
  };
  const pr = await request(`repos/${repository}/pulls/${number}`);
  const comparison = await request(`repos/${repository}/compare/${pr.base.sha}...${pr.head.sha}`);
  return { repository, number: Number(number), url: pr.html_url, title: pr.title, base: pr.base.sha, head: pr.head.sha,
    mergeBase: comparison.merge_base_commit.sha, headRepository: pr.head.repo?.full_name || null,
    resolvedAt: new Date().toISOString(), captureStatus: "not-captured" };
}

export async function captureRevision(store, options) {
  requireThat(options.execute === "yes", "Capture executes project commands. Review the configuration, then pass --execute yes.");
  options.signal?.throwIfAborted();
  const config = captureConfig(options.config, { profile: options.profile, screens: options.screens });
  const repo = realpathSync(options.repo), revision = resolveRevision(repo, options.ref);
  const role = choice(options.role || "pr", ["current", "target", "pr"], "role"), output = resolve(options.output);
  requireThat(!existsSync(output), "Capture output must be a new directory");
  const workspace = mkdtempSync(join(tmpdir(), "screens-capture-")), checkout = join(workspace, "checkout");
  let log = "";
  const context = { cwd: workspace, env: process.env, signal: options.signal, log: chunk => { log = (log + chunk).slice(-8 * 1024 * 1024); } };
  let result;
  try {
    await command(["git", "clone", "--no-hardlinks", "--no-checkout", "--", repo, checkout], context);
    await command(["git", "-C", checkout, "checkout", "--detach", revision], context);
    const recipe = { ...config.value, env: { ...config.value.env, SCREENS_HOME: "{root}/.screens/capture-registry" } };
    result = await executeCaptureRecipe(store, { ...options, profile: undefined, screens: undefined,
      input: automaticInput(checkout, { recipe }), mode: "commit", revision, role, configHash: config.hash,
      preparationLog: log, title: options.title || `${role} · ${revision.slice(0, 8)}` });
  } catch (error) {
    mkdirSync(output, { recursive: true });
    if (!existsSync(join(output, "capture.log"))) writeFileSync(join(output, "capture.log"), log, { flag: "wx" });
    throw error;
  } finally { rmSync(workspace, { recursive: true, force: true }); }
  return result;
}
export async function captureComparison(store, options) {
  const config = captureConfig(options.config, { profile: options.profile }), repo = realpathSync(options.repo);
  const context = options.context || { kind: "git-revisions", base: resolveRevision(repo, options.base), head: resolveRevision(repo, options.head) };
  const base = resolveRevision(repo, context.mergeBase || context.base), head = resolveRevision(repo, context.head), output = resolve(options.output);
  const current = await captureRevision(store, { ...options, ref: base, role: "current", output: join(output, "current") });
  const pr = await captureRevision(store, { ...options, ref: head, role: "pr", output: join(output, "pr") });
  if (options.verifyPR) requireThat((await resolvePullRequest(context.repository, context.number)).head === head, "PR head changed during capture; evidence retained, comparison not published", 409);
  requireThat(current.run && pr.run && !current.exitCode && !pr.exitCode, "Capture did not complete; inspect the retained reports before comparing", 422);
  const run = combineRuns(store, { project: config.value.project.id, current: current.run.id, pr: pr.run.id, target: options.target, title: options.title || (context.number ? `PR ${context.number} · ${context.title}` : "Git revision comparison"), source: { ...context, mergeBase: base, head, captureStatus: "captured", configHash: config.hash } });
  writeFileSync(join(output, "comparison.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx" });
  return { run, current, pr, url: `http://127.0.0.1:${options.port || 4800}/?project=${encodeURIComponent(run.project)}&run=${run.id}` };
}
