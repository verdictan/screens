const categories = [
  ["changed-inputs", /Source or capture inputs changed|Resume uses frozen/i, "Create a new automatic capture job for the changed source or settings."],
  ["fixture-reset", /fixture (?:setup|reset|teardown)/i, "Check the fixture lifecycle command and its service endpoint before retrying the scenario."],
  ["missing-setting", /environment|capture variable|setting/i, "Set the named variable in envFiles or the capture environment."],
  ["login-failure", /authenticat|login|session|HTTP 401|HTTP 403/i, "Check the fixture account, login response, and auth readiness condition."],
  ["unknown-fixture-id", /parameter|fixture source|fixture parameter|concrete|record/i, "Map the route parameter to a declared fixture record or API response."],
  ["unavailable-service", /service|server|ECONNREFUSED|ENOTFOUND|become ready|exited/i, "Check the service log, command, endpoint, port, and dependencies."],
  ["readiness-failure", /readiness|navigation|redirect|page error|HTTP|locator|timeout|unverified/i, "Check the expected state, fixture data, and readiness condition."],
];
export function captureSummary(report) {
  const groups = new Map();
  const add = (reason, affected) => {
    const [cause, , action] = categories.find(([, pattern]) => pattern.test(reason)) || ["capture-failure", null, "Read the application capture log and correct the named command or scenario."];
    if (!groups.has(cause)) groups.set(cause, { cause, action, affected: [] });
    const rows = groups.get(cause).affected;
    if (!rows.some(row => row.reason === reason && row.scenario === affected.scenario && row.device === affected.device)) rows.push({ ...affected, reason });
  };
  for (const reason of report.fixtureErrors || []) add(reason, { application: "fixture lifecycle" });
  if (report.error) add(report.error, { application: "setup" });
  for (const [index, app] of (report.applications || []).entries()) for (const issue of app.issues || []) {
    if ((report.scenarios || []).some(row => row.applicationIndex === index && row.readiness?.reason && issue.includes(row.readiness.reason))) continue;
    add(issue, { application: app.path });
  }
  for (const row of report.scenarios || []) if (row.readiness?.status !== "passed") add(row.readiness?.reason || "Unverified readiness", { scenario: row.key, device: row.variant.device });
  return { status: report.status, job: report.job || null, images: report.run?.captureIds.length || 0, reused: (report.scenarios || []).filter(row => row.reused).length,
    metrics: report.coverage?.metrics || null, groups: [...groups.values()], reviewUrl: report.url || null };
}
export function formatCaptureSummary(summary) {
  const lines = [`Capture ${summary.status}: ${summary.images} images, ${summary.reused} reused`];
  if (summary.job) lines.push(`Job: ${summary.job}`);
  if (summary.metrics) {
    const { screens, scenarios, variants, candidates } = summary.metrics;
    lines.push(`Screens ready ${screens.ready}/${screens.total}; scenarios ready ${scenarios.ready}/${scenarios.total}; variants ready ${variants.ready}/${variants.total}; unresolved candidates ${candidates.unresolved}`);
  }
  for (const group of summary.groups) {
    lines.push(`${group.cause}: ${group.affected.length} affected. ${group.action}`);
    for (const row of group.affected.slice(0, 5)) lines.push(`  ${row.scenario || row.application}${row.device ? ` (${row.device})` : ""}: ${row.reason.split("\n")[0]}`);
    if (group.affected.length > 5) lines.push(`  ${group.affected.length - 5} more in report.json`);
  }
  if (summary.reviewUrl) lines.push(`Review: ${summary.reviewUrl}`);
  return lines.join("\n") + "\n";
}
