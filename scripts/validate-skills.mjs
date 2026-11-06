import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../skills/screens/", import.meta.url));
const skill = readFileSync(join(root, "SKILL.md"), "utf8");
if (!/^---\nname: screens\ndescription: [^\n]+\n---\n/.test(skill))
  throw Error("Invalid skill frontmatter");
if (/TODO|FIXME/.test(skill)) throw Error("Unfinished skill");
for (const resource of ["scripts/screens.mjs", "agents/openai.yaml"])
  if (!existsSync(join(root, resource))) throw Error(`Missing ${resource}`);
execFileSync(process.execPath, ["--check", join(root, "scripts/screens.mjs")], {
  stdio: "inherit",
});
console.log(
  "Shared Screens skill metadata and executable resource validated for both client packages.",
);
