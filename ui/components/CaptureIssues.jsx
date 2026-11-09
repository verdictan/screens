import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Button } from "./ui/button";

const titles = { "changed-inputs": "Project changed", "fixture-reset": "Sample data could not reset", "missing-setting": "Missing settings", "login-failure": "Sign-in failed", "unknown-fixture-id": "Missing sample records", "unavailable-service": "App or service unavailable", "readiness-failure": "Screen did not become ready", "capture-failure": "Capture needs attention" };
export function CaptureIssues({ groups = [], missing = [], onCapture }) {
  if (!groups.length && !missing.length) return null;
  return <section className="capture-issues" aria-label="Capture problems">
    <h2>Capture needs attention</h2>
    {groups.map(group => <Collapsible key={group.cause}>
      <CollapsibleTrigger>{titles[group.cause] || group.cause}<span>{group.affected.length}</span></CollapsibleTrigger>
      <CollapsibleContent><p>{group.action}</p><ul>{group.affected.map((row, index) => <li key={index}><strong>{row.scenario || row.application}{row.device ? ` · ${row.device}` : ""}</strong><p>{row.reason}</p></li>)}</ul></CollapsibleContent>
    </Collapsible>)}
    {missing.length > 0 && <Collapsible><CollapsibleTrigger>Missing screenshots<span>{missing.length}</span></CollapsibleTrigger><CollapsibleContent><p>Capture these screens, or add a scenario for each state that cannot be opened directly.</p><ul>{missing.map(screen => <li key={screen.id}>{screen.title}</li>)}</ul></CollapsibleContent></Collapsible>}
    {onCapture && <Button variant="secondary" size="sm" onClick={() => onCapture("current")}>Prepare another capture</Button>}
  </section>;
}
