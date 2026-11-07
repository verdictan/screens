import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import React, { startTransition, useEffect, useOptimistic, useState } from "react";
import {
  ArrowUpRight,
  MessageSquare,
  Check,
  Pin,
  FileCheck2,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { api, labels } from "@/lib/api";
import { Field, FieldLabel, FieldSet } from "./components/ui/field";
import { CaptureImage } from "./components/CaptureImage";
import { useUndo } from "./lib/undo";
const captureOptions = (entry) =>
  Object.entries(entry.captures).map(([role, c]) => (
    <NativeSelectOption value={c.id} key={c.id}>
      {labels[role]}
    </NativeSelectOption>
  ));
const noteStatus = { open: "Open", "in-progress": "In progress", submitted: "Ready to review", verified: "Verified", "wont-fix": "Not planned" };

export function Feedback({ entry, notes, pin, setPin, perform }) {
  const waitForUndo = useUndo();
  const [pending, setPending] = useState(new Set());
  const [optimisticNotes, updateOptimistic] = useOptimistic(notes, (current, id) => current.map((note) => note.id === id ? { ...note, status: "open" } : note));
  const [capture, setCapture] = useState(pin?.capture || entry.captures.pr?.id || entry.captures.current?.id || entry.captures.target?.id);
  const [busy, setBusy] = useState(false);
  const [author, setAuthor] = useState("Reviewer");
  useEffect(() => { if (pin) setCapture(pin.capture); }, [pin]);
  const visible = new Set(Object.values(entry.captures).map((item) => item.id));
  function updateStatus(note, status) {
    setPending((current) => new Set([...current, note.id]));
    startTransition(async () => {
      try {
        if (status === "open") {
          updateOptimistic(note.id);
          if (!await waitForUndo("Feedback reopened")) return;
        }
        await perform(() => api("/api/notes/update", { id: note.id, expectedRevision: note.revision, status }), status === "verified" ? "Fix verified" : "Feedback reopened");
      } finally { setPending((current) => new Set([...current].filter((id) => id !== note.id))); }
    });
  }
  return <div className="feedback-panel">
    <div className="panel-heading"><h2>Leave feedback</h2><p>Comments stay with the selected screenshot.</p></div>
    <form id="note-form" className="feedback-composer" onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      perform(async () => {
        setBusy(true);
        try {
          await api("/api/notes", { capture: values.get("capture"), text: values.get("text"), author: values.get("author"), point: pin?.capture === values.get("capture") ? pin.point || null : null, region: pin?.capture === values.get("capture") ? pin.region || null : null });
          form.reset();
          setPin(null);
        } finally { setBusy(false); }
      }, "Feedback added");
    }}>
      <FieldSet disabled={busy}>
        <Field ><FieldLabel htmlFor="note-text">What should change?</FieldLabel><Textarea id="note-text" name="text" required maxLength={10000} placeholder="Make the button easier to find…" /></Field>
        <div className="feedback-destination"><Field ><FieldLabel htmlFor="note-capture">Screenshot</FieldLabel><NativeSelect id="note-capture" name="capture" value={capture} onChange={(event) => { setCapture(event.target.value); setPin(null); }}>{captureOptions(entry)}</NativeSelect></Field><Button type="submit" disabled={busy} shortcut="Mod+Enter">{busy ? "Adding…" : "Add note"}</Button></div>
        {(pin?.point || pin?.region) && <div className="pin-context"><span><Pin />{pin.region ? `Selected area · ${Math.round(pin.region.width * 100)}% × ${Math.round(pin.region.height * 100)}%` : `Pinned at ${Math.round(pin.point.x * 100)}%, ${Math.round(pin.point.y * 100)}%`}</span><Button variant="ghost" size="sm" onClick={async () => { const previous = pin; setPin(null); if (!await waitForUndo("Annotation cleared")) setPin((current) => current || previous); }}>Remove selection</Button></div>}
        <Collapsible className="author-details"><CollapsibleTrigger>Posting as {author || "reviewer"}</CollapsibleTrigger><CollapsibleContent><Field ><FieldLabel htmlFor="author">Your name</FieldLabel><Input id="author" name="author" value={author} onChange={(event) => setAuthor(event.target.value)} required maxLength={500} /></Field></CollapsibleContent></Collapsible>
      </FieldSet>
    </form>
    <div className="conversation-heading"><h3>Conversation</h3><span>{notes.length}</span></div>
    <div id="notes" className="conversation">
      {[...optimisticNotes].reverse().map((note) => <article key={note.id} id={`note-${note.id}`} tabIndex={-1} className="note-entry">
        <div className="note-heading"><div><strong>{note.author}</strong><time dateTime={note.createdAt} title={new Date(note.createdAt).toLocaleString()}>{new Date(note.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></div><Badge variant={note.status === "verified" ? "success" : "secondary"}>{pending.has(note.id) ? "Pending" : noteStatus[note.status]}</Badge></div>
        <p className="note-text">{note.text}</p>
        {note.region && <p className="note-area-context">Area comment · {Math.round(note.region.width * 100)}% × {Math.round(note.region.height * 100)}% of the screenshot</p>}
        {note.resolution && <div className="note-resolution"><h4>Resolution</h4><p>{note.resolution}</p></div>}
        <div className="note-actions">
          <a href={`/api/captures/${note.capture}/image`} target="_blank" rel="noopener">{visible.has(note.capture) ? "Original screenshot" : "Earlier screenshot"}<ArrowUpRight /></a>
          {note.evidence && <a href={`/api/captures/${note.evidence}/image`} target="_blank" rel="noopener">View fix<ArrowUpRight /></a>}
          {note.status === "submitted" && <Button size="sm" disabled={pending.has(note.id)} onClick={() => updateStatus(note, "verified")}><Check />Verify fix</Button>}
          {note.status !== "open" && <Button size="sm" variant="ghost" disabled={pending.has(note.id)} onClick={() => updateStatus(note, "open")}>Reopen</Button>}
        </div>
      </article>)}
      {!notes.length && <div className="panel-empty"><MessageSquare aria-hidden="true" /><p>No notes yet</p><span>Select a spot on the image, or write a note above.</span></div>}
    </div>
  </div>;
}
export function Evidence({ entry, evidence, perform }) {
  const [busy, setBusy] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  return (
    <div className="evidence-panel">
      <div className="panel-heading"><h2>Review evidence</h2><p>Reports and recordings for this screenshot.</p></div>
      <Collapsible className="evidence-composer" open={composerOpen} onOpenChange={setComposerOpen}><CollapsibleTrigger><Plus /><span>Add evidence</span></CollapsibleTrigger><CollapsibleContent>
      <Card>
        <CardContent>
          <form
            id="evidence-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget,
                values = new FormData(form);
              const input = Object.fromEntries(
                [
                  "capture",
                  "kind",
                  "method",
                  "outcome",
                  "assertion",
                  "procedure",
                  "observation",
                  "author",
                ].map((k) => [k, values.get(k)]),
              );
              const file = form.querySelector("[type=file]").files[0];
              perform(async () => {
                setBusy(true);
                try {
                  if (file) {
                    if (file.size > 20 * 1024 * 1024)
                      throw Error("Evidence artifact exceeds 20 MB.");
                    const types = {
                      txt: "text/plain",
                      log: "text/plain",
                      json: "application/json",
                      mp4: "video/mp4",
                      webm: "video/webm",
                    };
                    input.artifactType =
                      types[file.name.split(".").pop().toLowerCase()];
                    if (!input.artifactType)
                      throw Error(
                        "Use a text/JSON report or MP4/WebM recording.",
                      );
                    input.artifactBase64 = await new Promise(
                      (resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () =>
                          resolve(reader.result.split(",")[1]);
                        reader.onerror = () =>
                          reject(Error("Could not read the attachment"));
                        reader.readAsDataURL(file);
                      },
                    );
                  }
                  await api("/api/evidence", input);
                  form.reset();
                  setComposerOpen(false);
                } finally {
                  setBusy(false);
                }
              }, "Evidence saved");
            }}
          >
            <FieldSet disabled={busy} className="contents">
            <div className="form-grid">
              <Field ><FieldLabel htmlFor="evidence-capture">Capture</FieldLabel>
                <NativeSelect
                  id="evidence-capture"
                  name="capture"
                  defaultValue={
                    entry.captures.pr?.id ||
                    entry.captures.current?.id ||
                    entry.captures.target?.id
                  }
                >
                  {captureOptions(entry)}
                </NativeSelect>
              </Field>
              <Field ><FieldLabel htmlFor="evidence-kind">Check</FieldLabel>
                <NativeSelect id="evidence-kind" name="kind">
                  <NativeSelectOption value="visual">Visual</NativeSelectOption>
                  <NativeSelectOption value="behavior">Behavior</NativeSelectOption>
                  <NativeSelectOption value="accessibility">Accessibility</NativeSelectOption>
                  <NativeSelectOption value="motion">Motion</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field ><FieldLabel htmlFor="evidence-method">Method</FieldLabel>
                <NativeSelect id="evidence-method" name="method">
                  <NativeSelectOption value="manual">Manual observation</NativeSelectOption>
                  <NativeSelectOption value="automated">Automated check</NativeSelectOption>
                  <NativeSelectOption value="screenshot">Screenshot inspection</NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field ><FieldLabel htmlFor="evidence-outcome">Reported result</FieldLabel>
                <NativeSelect id="evidence-outcome" name="outcome">
                  <NativeSelectOption value="not-run">Not run</NativeSelectOption>
                  <NativeSelectOption value="pass">Pass</NativeSelectOption>
                  <NativeSelectOption value="fail">Fail</NativeSelectOption>
                </NativeSelect>
              </Field>
            </div>
            <Field ><FieldLabel htmlFor="evidence-assertion">What was checked?</FieldLabel>
              <Input
                id="evidence-assertion"
                name="assertion"
                required
                maxLength={4000}
                placeholder="Escape closes the dialog and returns focus"
              />
            </Field>
            <div className="form-grid">
              <Field ><FieldLabel htmlFor="evidence-procedure">Reproduction steps or command</FieldLabel>
                <Textarea
                  id="evidence-procedure"
                  name="procedure"
                  required
                  maxLength={10000}
                />
              </Field>
              <Field ><FieldLabel htmlFor="evidence-observation">Observed result</FieldLabel>
                <Textarea
                  id="evidence-observation"
                  name="observation"
                  required
                  maxLength={10000}
                />
              </Field>
            </div>
            <div className="form-grid">
              <Field ><FieldLabel htmlFor="evidence-author">Reporter</FieldLabel>
                <Input
                  id="evidence-author"
                  name="author"
                  defaultValue="Reviewer"
                  required
                  maxLength={500}
                />
              </Field>
              <Field ><FieldLabel htmlFor="evidence-file">Report or recording (up to 20 MB)</FieldLabel>
                <Input
                  id="evidence-file"
                  type="file"
                  accept=".txt,.log,.json,.mp4,.webm"
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy} shortcut="Mod+Enter">
                Save evidence
              </Button>
            </div>
            </FieldSet>
          </form>
        </CardContent>
      </Card>
      </CollapsibleContent></Collapsible>
      <p className="panel-footnote">Reported evidence does not approve a design or verify a fix.</p>
      <div id="evidence-list" className="evidence-list">
        {evidence.map((e, i) => (
          <Card key={e.id} className="evidence-entry">
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">{e.assertion}</h3>
                <Badge variant="outline">Reported {e.outcome}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {e.kind} · {e.method} · {e.author} ·{" "}
                {new Date(e.createdAt).toLocaleString()}
              </p>
              <p className="whitespace-pre-wrap text-sm">{e.observation}</p>
              <Collapsible>
                <CollapsibleTrigger className="text-xs font-medium">
                  Procedure and provenance
                </CollapsibleTrigger><CollapsibleContent>
                <pre className="mt-2 whitespace-pre-wrap break-all text-xs">
                  {e.procedure}
                </pre>
                <p className="mt-2 break-all text-[11px] text-muted-foreground">
                  Capture: {e.capture}
                  <br />
                  Revision: {e.sourceRevision} · Fixture: {e.fixture}
                </p>
              </CollapsibleContent></Collapsible>
              {e.artifact && (
                <a className="block text-xs underline" href={e.artifact.url}>
                  Download {e.artifact.mimeType} evidence ·{" "}
                  {e.artifact.hash.slice(0, 12)}
                </a>
              )}
            </CardContent>
          </Card>
        ))}
        {!evidence.length && (
          <div className="panel-empty"><FileCheck2 aria-hidden="true" /><p>No evidence recorded</p><span>Use Add evidence to record a result.</span></div>
        )}
      </div>
    </div>
  );
}
export function History({ detail }) {
  return <div className="history-panel">
    <div className="panel-heading"><h2>Screenshot history</h2></div>
    <div className="history-list">{detail.captures.map((capture) => <article key={capture.id} className="history-entry">
      <a className="history-preview" href={capture.url} target="_blank" rel="noopener" aria-label={`Open ${labels[capture.role].toLowerCase()} original`}><CaptureImage capture={capture} alt="" loading="lazy" /></a>
      <div className="history-description"><h3>{labels[capture.role]}</h3><time dateTime={capture.createdAt}>{new Date(capture.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time><p>{capture.variant.device}</p>
        <Collapsible><CollapsibleTrigger>Source details</CollapsibleTrigger><CollapsibleContent><dl><dt>Revision</dt><dd>{capture.revision}</dd><dt>Sample data</dt><dd>{capture.fixture}</dd></dl><p>{capture.provenance}</p><p className="capture-hash">SHA-256 {capture.hash}</p><a href={`/api/evidence?capture=${capture.id}`} target="_blank" rel="noopener">View capture evidence<ArrowUpRight /></a></CollapsibleContent></Collapsible>
      </div>
    </article>)}</div>
  </div>;
}
