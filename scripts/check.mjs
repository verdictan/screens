import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
for (const dir of ["src", "test", "scripts"])
  for (const file of readdirSync(dir))
    if (/\.(mjs|js)$/.test(file))
      execFileSync(process.execPath, ["--check", `${dir}/${file}`], {
        stdio: "inherit",
      });
const skill = readFileSync("skills/screens/SKILL.md", "utf8");
if (
  !skill.startsWith("---\nname: screens\ndescription:") ||
  skill.includes("TODO")
)
  throw new Error("Skill metadata incomplete");
console.log("Syntax and bundled skill metadata checks passed.");
