#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const owner = "verdictan",
  repository = "verdictan/screens",
  title = "screens";
const backlog = JSON.parse(
  readFileSync(
    new URL("../docs/project-backlog.json", import.meta.url),
    "utf8",
  ),
);
const directory = mkdtempSync(join(tmpdir(), "screens-github-"));
const gh = (...args) =>
  execFileSync("gh", args, {
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });
const json = (...args) => JSON.parse(gh(...args));
try {
  gh("auth", "status");
  // List operations must succeed before interpreting absence as permission to create.
  const repositories = json(
    "repo",
    "list",
    owner,
    "--limit",
    "1000",
    "--json",
    "name,url,isPrivate",
  );
  let repo = repositories.find((r) => r.name === "screens");
  const projects = json(
    "project",
    "list",
    "--owner",
    owner,
    "--limit",
    "1000",
    "--format",
    "json",
  ).projects;
  let project = projects.find((p) => p.title === title);
  if (!repo) {
    gh(
      "repo",
      "create",
      repository,
      "--private",
      "--description",
      "Central screen registry, visual review and agent workflows",
    );
    repo = { url: `https://github.com/${repository}` };
    console.log(`Created ${repo.url}`);
  }
  if (!project) {
    project = json(
      "project",
      "create",
      "--owner",
      owner,
      "--title",
      title,
      "--format",
      "json",
    );
    console.log(`Created ${project.url}`);
  }
  gh(
    "project",
    "link",
    String(project.number),
    "--owner",
    owner,
    "--repo",
    repository,
  );
  const fields = json(
    "project",
    "field-list",
    String(project.number),
    "--owner",
    owner,
    "--format",
    "json",
  ).fields;
  const status = fields.find((f) => f.name === "Status");
  const existing = json(
    "issue",
    "list",
    "--repo",
    repository,
    "--state",
    "all",
    "--limit",
    "1000",
    "--json",
    "title,url",
  );
  const items = json(
    "project",
    "item-list",
    String(project.number),
    "--owner",
    owner,
    "--limit",
    "1000",
    "--format",
    "json",
  ).items;
  const results = [];
  for (const [index, issue] of backlog.entries()) {
    let url = existing.find((i) => i.title === issue.title)?.url,
      created = false;
    if (!url) {
      const file = join(directory, `issue-${index}.md`);
      writeFileSync(file, issue.body + "\n");
      url = gh(
        "issue",
        "create",
        "--repo",
        repository,
        "--title",
        issue.title,
        "--body-file",
        file,
      ).trim();
      created = true;
    }
    const linked = items.find((i) => i.content?.url === url);
    const item =
      linked ||
      json(
        "project",
        "item-add",
        String(project.number),
        "--owner",
        owner,
        "--url",
        url,
        "--format",
        "json",
      );
    // Never reset an existing item's status on a subsequent run.
    if ((created || !linked) && status) {
      const option = status.options?.find(
        (o) => o.name.toLowerCase() === issue.status.toLowerCase(),
      );
      if (option)
        gh(
          "project",
          "item-edit",
          "--id",
          item.id,
          "--project-id",
          project.id,
          "--field-id",
          status.id,
          "--single-select-option-id",
          option.id,
        );
    }
    results.push({ title: issue.title, url });
  }
  const result = {
    repository: repo.url,
    project: project.url,
    issues: results,
  };
  writeFileSync(
    fileURLToPath(new URL("../docs/github-links.json", import.meta.url)),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    "GitHub setup stopped. Existing resources are retained; rerun after access is available.",
  );
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
