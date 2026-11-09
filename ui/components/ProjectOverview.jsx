import { workflows, jobPending } from "../../src/workflows.mjs";
import { useState } from "react";
import { ArrowRight, Camera, Check } from "lucide-react";
import { Button } from "./ui/button";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { CaptureImage } from "./CaptureImage";
import { CaptureIssues } from "./CaptureIssues";
import { api } from "../lib/api";

export function ProjectOverview({ project, workspace, onSelect, onCapture, onSession, perform }) {
  const [filter, setFilter] = useState("attention");
  const rows = workspace?.rows || [], attention = rows.filter(row => row.status !== "ready");
  const visible = filter === "attention" ? attention : rows;
  return <section className="project-overview" aria-busy={!workspace}>
    <header><div><h1>{project.name}</h1><p>{!workspace ? "Loading project…" : attention.length ? `${attention.length} ${attention.length === 1 ? "view needs" : "views need"} attention` : "Your review queue is clear"}</p></div><Button onClick={() => attention[0]?.captureIds.length && attention[0]?.status !== "missing" ? onSelect(attention[0]) : onCapture("current")}>{attention.length ? "Review next" : "Capture screens"}<ArrowRight /></Button></header>
    <CaptureJobs jobs={workspace?.jobs} {...{ perform, onSession }} />
    <CaptureIssues groups={workspace?.problems} onCapture={onCapture} />
    {workspace && <p className="overview-counts">{new Set(rows.map(row => row.screen)).size} screens · {rows.filter(row => row.variant).length} captured layouts</p>}
    {workspace && <ToggleGroup type="single" value={filter} onValueChange={value => value && setFilter(value)} aria-label="Project review filter"><ToggleGroupItem value="attention">Needs attention {attention.length}</ToggleGroupItem><ToggleGroupItem value="all">All views {rows.length}</ToggleGroupItem></ToggleGroup>}
    <div className="review-queue">
      {visible.map(row => <button key={`${row.screen}|${JSON.stringify(row.variant)}`} className="queue-entry" title={row.variant ? Object.values(row.variant).join(" · ") : row.title} onClick={() => row.captureIds.length && row.status !== "missing" ? onSelect(row) : onCapture("current")}>
        <span className="queue-thumbnail" aria-hidden="true">{row.captures ? <CaptureImage capture={row.captures.pr || row.captures.current || row.captures.target} alt="" loading="lazy" /> : <Camera />}</span>
        <span><strong>{row.title}</strong><span>{row.variant ? `${row.variant.device} · ${row.variant.viewport}${row.variant.browser !== "unspecified" ? ` · ${row.variant.browser}` : ""}` : "No screenshot yet"}</span></span>
        <span className="queue-action">{row.label}<ArrowRight /></span>
      </button>)}
      {workspace && !visible.length && <div className="queue-empty"><Check /><h2>{rows.length ? "Nothing waiting for review" : "Capture your first screen"}</h2><p>{rows.length ? "Browse all screens, or capture a new version to review." : "Choose your app folder. Screens will prepare a capture plan before running any commands."}</p><Button variant="secondary" onClick={() => rows.length ? setFilter("all") : onCapture("current")}>{rows.length ? "Browse all screens" : "Prepare captures"}</Button></div>}
    </div>
  </section>;
}
export function CaptureJobs({ jobs = [], perform, onSession }) {
  if (!jobs.length) return null;
  return <section className="capture-jobs" aria-label="Capture activity"><h2>Capture activity</h2>{jobs.slice(0, 5).map(job => <article key={job.id}>
    <div><strong>{job.title || "Screen capture"}</strong><p role={jobPending(job) ? 'status' : undefined}>{workflows.job.states[job.status].label} · {job.images} screenshots</p>{job.error && <p className="capture-error">{job.error}</p>}</div>
    <div className="job-actions">{job.result && <Button variant="secondary" size="sm" onClick={() => onSession(job.result)}>Review captures</Button>}
      {job.status !== "queued" && job.availableActions.includes("resume") && <Button variant="ghost" size="sm" onClick={() => perform(() => api("/api/automation/jobs-change", { id: job.id, expectedRevision: job.revision, resume: true }), "Capture queued")}>Resume</Button>}
      {jobPending(job) && job.availableActions.includes("cancel") && <Button variant="ghost" size="sm" onClick={() => perform(() => api("/api/automation/jobs-change", { id: job.id, expectedRevision: job.revision, resume: false }), "Capture stopped")}>Stop</Button>}
    </div>
  </article>)}</section>;
}
