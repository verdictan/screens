import { useEffect, useReducer, useRef, useState } from "react";
import { Camera, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Field, FieldLabel, FieldSet } from "./ui/field";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible";
import { workflows } from "../../src/workflows.mjs";
import { captureFlow, initialCaptureFlow, recipeEditor } from "../lib/workflows";
import { api, labels } from "../lib/api";

export function CaptureWorkspace({ open, onOpenChange, project: activeProject, folder: activeFolder, role: activeRole, run: activeRun, entry: activeEntry, onStarted, onSession }) {
  const [scope, setScope] = useState(() => ({ project: activeProject, folder: activeFolder, role: activeRole, run: activeRun, entry: activeEntry }));
  const { project, folder, role: initialRole, run, entry } = scope;
  const generation = useRef(0), request = useRef(null);
  const [destination, setDestination] = useState(project?.id || "");
  const [path, setPath] = useState(folder || ""), [role, setRole] = useState(initialRole || "current");
  const [flow, dispatch] = useReducer(captureFlow, initialCaptureFlow);
  const { plan, error, phase } = flow;
  const busy = ["preparing", "starting", "uploading"].includes(phase);
  const [configuration, setConfiguration] = useState(""), [file, setFile] = useState(null);
  useEffect(() => {
    if (open) {
      setScope({ project: activeProject, folder: activeFolder, role: activeRole, run: activeRun, entry: activeEntry });
      setDestination(activeProject?.id || ""); setPath(activeFolder || ""); setRole(activeRole || "current");
      dispatch({ type: "reset" }); setConfiguration(""); setFile(null);
    }
    return () => { generation.current++; request.current = null; };
  }, [open]);
  function invalidate() { dispatch({ type: "edit" }); }
  function begin(type) {
    if (request.current || !workflows.plan.events[type].from.includes(phase)) return null;
    const token = { generation: generation.current };
    request.current = token; dispatch({ type });
    return token;
  }
  const owns = token => token && request.current === token && generation.current === token.generation;
  const finish = token => { if (owns(token)) request.current = null; };
  async function prepare(event) {
    event.preventDefault();
    const token = begin("prepare");
    if (!token) return;
    try {
      const result = await api("/api/workspace/prepare", { path, project: destination || undefined, role, review: destination === project?.id ? run?.id : undefined, ...(configuration ? { recipe: JSON.parse(configuration) } : {}) });
      if (!owns(token)) return;
      dispatch({ type: "prepared", plan: result }); setConfiguration(JSON.stringify(result.configuration, null, 2));
    } catch (error) { if (owns(token)) dispatch({ type: "failure", error }); }
    finally { finish(token); }
  }
  async function start() {
    const token = begin("start");
    if (!token) return;
    try {
      const job = await api("/api/workspace/capture", { plan: plan.id });
      if (!owns(token)) return;
      dispatch({ type: "success" }); onStarted(job.config.project.id); onOpenChange(false);
    } catch (error) { if (owns(token)) dispatch({ type: "failure", error }); }
    finally { finish(token); }
  }
  async function upload(event) {
    event.preventDefault();
    const token = begin("upload");
    if (!token) return;
    try {
      const imageBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = () => reject(Error("Could not read this image"));
        reader.onabort = () => reject(Error("Image reading was cancelled"));
        reader.readAsDataURL(file);
      });
      if (!owns(token)) return;
      const session = await api("/api/workspace/upload", { run: run.id, screen: entry.screen, variant: entry.variant, role, imageBase64, revision: "uploaded", fixture: "unspecified", provenance: `Uploaded screenshot: ${file.name}`, title: `${labels[role]} added · ${entry.title}` });
      if (!owns(token)) return;
      dispatch({ type: "success" }); onSession(session.id); onOpenChange(false);
    } catch (error) { if (owns(token)) dispatch({ type: "failure", error }); }
    finally { finish(token); }
  }
  const editor = recipeEditor(configuration);
  const recipe = editor.recipe;
  function updateRecipe(next) { setConfiguration(JSON.stringify(next, null, 2)); invalidate(); }
  function updateApp(index, changes) { updateRecipe({ ...recipe, applications: recipe.applications.map((app, i) => i === index ? { ...app, ...changes } : app) }); }
  const blocked = phase === "blocked";
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent className="capture-dialog" closeDisabled={busy}>
    <DialogHeader><DialogTitle>{role === "target" ? "Add a design reference" : "Capture your app"}</DialogTitle><DialogDescription>Choose an app folder and review the plan. Commands run only when you start capture.</DialogDescription></DialogHeader>
    <form onSubmit={prepare}><FieldSet disabled={busy}>
      {project && <Field><FieldLabel htmlFor="capture-destination">Project</FieldLabel><NativeSelect id="capture-destination" value={destination} onChange={event => { setDestination(event.target.value); setConfiguration(""); invalidate(); }}><NativeSelectOption value={project.id}>{project.name}</NativeSelectOption><NativeSelectOption value="">New project from this folder</NativeSelectOption></NativeSelect></Field>}
      <Field><FieldLabel htmlFor="capture-purpose">Use screenshots as</FieldLabel><NativeSelect id="capture-purpose" value={role} onChange={event => { setRole(event.target.value); invalidate(); }}>{Object.entries(labels).map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field>
      <Field><FieldLabel htmlFor="capture-folder">App folder on this computer</FieldLabel><Input id="capture-folder" value={path} onChange={event => { setPath(event.target.value); setConfiguration(""); invalidate(); }} required placeholder="/path/to/your/app" autoComplete="off" /></Field>
      {editor.phase === "structured" && <div className="capture-app-settings">
        {recipe.applications.filter(app => app.adapter === "browser").map(app => {
          const index = recipe.applications.indexOf(app);
          return <div key={app.path}><h3>{app.path === "." ? "Your app" : app.path}</h3>
            <Field><FieldLabel htmlFor={`app-url-${index}`}>Running app URL (optional)</FieldLabel><Input id={`app-url-${index}`} type="url" value={app.baseUrl || ""} placeholder="http://localhost:3000" onChange={event => updateApp(index, { baseUrl: event.target.value || undefined })} /></Field>
            <Field><FieldLabel htmlFor={`app-ready-${index}`}>Ready when this element appears</FieldLabel><Input id={`app-ready-${index}`} value={typeof app.ready === "string" ? app.ready : app.ready?.selector || ""} placeholder='[data-capture-ready="true"]' onChange={event => updateApp(index, { ready: { ...(typeof app.ready === "object" ? app.ready : {}), selector: event.target.value || undefined } })} /></Field>
          </div>;
        })}
        <Field><FieldLabel htmlFor="capture-env-files">Additional environment files (one per line)</FieldLabel><Textarea id="capture-env-files" value={(recipe.envFiles || []).join("\n")} onChange={event => updateRecipe({ ...recipe, envFiles: event.target.value.split("\n").filter(Boolean) })} placeholder=".env.capture" /></Field>
        {(recipe.services || []).map((service, index) => <Field key={service.name}><FieldLabel htmlFor={`service-ready-${index}`}>{service.name} readiness URL</FieldLabel><Input id={`service-ready-${index}`} value={service.ready?.url || ""} onChange={event => updateRecipe({ ...recipe, services: recipe.services.map((item, i) => i === index ? { ...item, ready: { ...item.ready, url: event.target.value } } : item) })} placeholder="http://127.0.0.1:{ports.service}/health" /></Field>)}
      </div>}
      <Collapsible><CollapsibleTrigger>Advanced capture settings</CollapsibleTrigger><CollapsibleContent><Field><FieldLabel htmlFor="capture-configuration">Recipe JSON</FieldLabel><Textarea id="capture-configuration" className="recipe-editor" value={configuration} onChange={event => { setConfiguration(event.target.value); invalidate(); }} placeholder="Prepare the plan to see detected settings" spellCheck={false} /></Field>{editor.message && <p role="status">{editor.message}</p>}<p>Set app URLs, readiness, login, services, sample data and device sizes here. Changes apply to this capture job.</p></CollapsibleContent></Collapsible>
      <Button type="submit" variant={plan ? "secondary" : "default"} disabled={busy}>{busy ? "Working…" : plan ? "Refresh plan" : "Prepare capture plan"}</Button>
    </FieldSet></form>
    {plan && <section className="capture-plan"><h2>{plan.applications} {plan.applications === 1 ? "app" : "apps"} · {plan.scenarios} declared states</h2><p>Default browser layouts include desktop, tablet and phone. Native captures use the app's declared devices. Capture results report unresolved states separately.</p>
      {plan.commands.length > 0 && <Collapsible><CollapsibleTrigger>Commands that will run</CollapsibleTrigger><CollapsibleContent><ul>{plan.commands.map((item, index) => <li key={index}><span>{item.location}</span><code>{item.command.join(" ")}</code></li>)}</ul><p>Capture may also run login steps and fixture setup, reset and cleanup from the recipe. Review all capture settings before starting.</p></CollapsibleContent></Collapsible>}
      {plan.decisions.length > 0 && <div className="capture-decisions"><h3>{blocked ? "Complete these settings first" : "Review these capture limits"}</h3><ul>{plan.decisions.map((item, index) => <li key={index}>{item.application && item.application !== "." ? `${item.application}: ` : ""}{item.question}</li>)}</ul></div>}
      {plan.warnings?.length > 0 && <Collapsible><CollapsibleTrigger>Discovery limits</CollapsibleTrigger><CollapsibleContent><ul>{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></CollapsibleContent></Collapsible>}
      <Button disabled={phase !== "ready"} onClick={start}><Camera />{busy ? "Starting…" : "Start capture"}</Button>
    </section>}
    {entry && destination === project?.id && <Collapsible defaultOpen={initialRole === "target"}><CollapsibleTrigger>Upload an existing screenshot</CollapsibleTrigger><CollapsibleContent><form className="capture-upload" onSubmit={upload}><Field><FieldLabel htmlFor="capture-upload">Image for {entry.title} · {entry.variant.device}</FieldLabel><Input id="capture-upload" type="file" accept="image/png,image/jpeg,image/webp" required disabled={busy} onChange={event => setFile(event.target.files[0] || null)} /></Field><p>The original image stays at its exact size. Adding a design reference does not approve it.</p><Button type="submit" variant="secondary" disabled={busy || !file}><Upload />{busy ? "Adding…" : "Add screenshot"}</Button></form></CollapsibleContent></Collapsible>}
    {error && <p className="capture-error" role="alert">{error}</p>}
  </DialogContent></Dialog>;
}
