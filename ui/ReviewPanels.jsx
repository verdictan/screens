import React, { useEffect, useState } from "react";
import {
  ArrowUpRight,
  MessageSquare,
  Check,
  Pin,
  FileCheck2,
  History as HistoryIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { api, labels } from "@/lib/api";
import { Field } from "./App";
const captureOptions = (entry) =>
  Object.entries(entry.captures).map(([role, c]) => (
    <option value={c.id} key={c.id}>
      {labels[role]}
    </option>
  ));
export function Feedback({
  entry,
  detail,
  notes,
  pin,
  setPin,
  perform,
  refresh,
}) {
  const [capture, setCapture] = useState(
      pin?.capture ||
        entry.captures.pr?.id ||
        entry.captures.current?.id ||
        entry.captures.target?.id,
    ),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (pin) setCapture(pin.capture);
  }, [pin]);
  const visible = new Set(Object.values(entry.captures).map((c) => c.id));
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="size-4" />
            Capture-bound feedback
          </CardTitle>
          <CardDescription>
            Notes stay on the original image, even when new captures arrive.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="note-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget,
                data = new FormData(form);
              perform(async () => {
                setBusy(true);
                try {
                  await api("/api/notes", {
                    capture: data.get("capture"),
                    text: data.get("text"),
                    author: data.get("author"),
                    point: pin?.point || null,
                  });
                  form.reset();
                  setPin(null);
                  refresh();
                } finally {
                  setBusy(false);
                }
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Capture">
                <NativeSelect
                  id="note-capture"
                  name="capture"
                  value={capture}
                  onChange={(e) => {
                    setCapture(e.target.value);
                    setPin(null);
                  }}
                >
                  {captureOptions(entry)}
                </NativeSelect>
              </Field>
              <Field label="Your name">
                <Input
                  id="author"
                  name="author"
                  defaultValue="Reviewer"
                  required
                  maxLength={500}
                />
              </Field>
            </div>
            <Field label="Feedback">
              <Textarea
                id="note-text"
                name="text"
                required
                maxLength={10000}
                placeholder="What should change, and why?"
              />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Pin className="size-3" />
                {pin
                  ? `Pin at ${Math.round(pin.point.x * 100)}%, ${Math.round(pin.point.y * 100)}%`
                  : "Click an image in Compare to add a pin."}
                {pin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPin(null)}
                  >
                    Clear pin
                  </Button>
                )}
              </span>
              <Button type="submit" disabled={busy}>
                Add feedback
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <div id="notes" className="space-y-3">
        {notes.map((n) => (
          <Card key={n.id}>
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {n.author} · {new Date(n.createdAt).toLocaleString()}
                </span>
                <Badge
                  variant={n.status === "verified" ? "success" : "secondary"}
                >
                  {n.status}
                </Badge>
              </div>
              <p className="whitespace-pre-wrap text-sm">{n.text}</p>
              {n.resolution && (
                <p className="text-sm text-muted-foreground">
                  Resolution: {n.resolution}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="ghost" size="sm">
                  <a
                    href={`/api/captures/${n.capture}/image`}
                    target="_blank"
                    rel="noopener"
                  >
                    {visible.has(n.capture)
                      ? "Original capture"
                      : "Earlier capture"}
                    <ArrowUpRight />
                  </a>
                </Button>
                {n.evidence && (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`/api/captures/${n.evidence}/image`}
                      target="_blank"
                      rel="noopener"
                    >
                      Submitted evidence
                      <ArrowUpRight />
                    </a>
                  </Button>
                )}
                {n.status === "submitted" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      perform(async () => {
                        await api("/api/notes/update", {
                          id: n.id,
                          expectedRevision: n.revision,
                          status: "verified",
                        });
                        refresh();
                      })
                    }
                  >
                    <Check />
                    Verify fix
                  </Button>
                )}
                {n.status !== "open" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      perform(async () => {
                        await api("/api/notes/update", {
                          id: n.id,
                          expectedRevision: n.revision,
                          status: "open",
                        });
                        refresh();
                      })
                    }
                  >
                    Reopen
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {!notes.length && (
          <p className="py-5 text-center text-sm text-muted-foreground">
            No feedback yet. This screen has not been approved by default.
          </p>
        )}
      </div>
    </div>
  );
}
export function Evidence({ entry, evidence, perform, refresh }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileCheck2 className="size-4" />
            Verification evidence
          </CardTitle>
          <CardDescription>
            Record a real observation, test report, or motion recording.
            Reported results do not approve a screen.
          </CardDescription>
        </CardHeader>
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
                  refresh();
                } finally {
                  setBusy(false);
                }
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Capture">
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
              <Field label="Check">
                <NativeSelect id="evidence-kind" name="kind">
                  <option value="visual">Visual</option>
                  <option value="behavior">Behavior</option>
                  <option value="accessibility">Accessibility</option>
                  <option value="motion">Motion</option>
                </NativeSelect>
              </Field>
              <Field label="Method">
                <NativeSelect id="evidence-method" name="method">
                  <option value="manual">Manual observation</option>
                  <option value="automated">Automated check</option>
                  <option value="screenshot">Screenshot inspection</option>
                </NativeSelect>
              </Field>
              <Field label="Reported result">
                <NativeSelect id="evidence-outcome" name="outcome">
                  <option value="not-run">Not run</option>
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                </NativeSelect>
              </Field>
            </div>
            <Field label="What was checked?">
              <Input
                id="evidence-assertion"
                name="assertion"
                required
                maxLength={4000}
                placeholder="Escape closes the dialog and returns focus"
              />
            </Field>
            <div className="grid gap-4 xl:grid-cols-2">
              <Field label="Reproduction steps or command">
                <Textarea
                  id="evidence-procedure"
                  name="procedure"
                  required
                  maxLength={10000}
                />
              </Field>
              <Field label="Observed result">
                <Textarea
                  id="evidence-observation"
                  name="observation"
                  required
                  maxLength={10000}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reporter">
                <Input
                  id="evidence-author"
                  name="author"
                  defaultValue="Reviewer"
                  required
                  maxLength={500}
                />
              </Field>
              <Field label="Report or recording (up to 20 MB)">
                <Input
                  id="evidence-file"
                  type="file"
                  accept=".txt,.log,.json,.mp4,.webm"
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                Save evidence
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <div id="evidence-list" className="space-y-3">
        {evidence.map((e) => (
          <Card key={e.id}>
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
              <details>
                <summary className="text-xs font-medium">
                  Procedure and provenance
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">
                  {e.procedure}
                </pre>
                <p className="mt-2 break-all text-[11px] text-muted-foreground">
                  Capture: {e.capture}
                  <br />
                  Revision: {e.sourceRevision} · Fixture: {e.fixture}
                </p>
              </details>
              {e.artifact && (
                <a className="block text-xs underline" href={e.artifact.url}>
                  Download {e.artifact.mimeType} evidence ·{" "}
                  {e.artifact.hash.slice(0, 12)}
                </a>
              )}
              <p className="text-xs text-muted-foreground">
                Reporter-supplied evidence. Acceptance has not been assessed.
              </p>
            </CardContent>
          </Card>
        ))}
        {!evidence.length && (
          <p className="py-5 text-center text-sm text-muted-foreground">
            No checks recorded for these captures.
          </p>
        )}
      </div>
    </div>
  );
}
export function History({ detail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HistoryIcon className="size-4" />
          Capture history
        </CardTitle>
        <CardDescription>
          Immutable originals, source revisions, and recorded provenance.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {detail.captures.map((c) => (
          <article key={c.id} className="space-y-2 py-4 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{labels[c.role]}</Badge>
              <span className="text-xs text-muted-foreground">
                {c.variant.device} · {new Date(c.createdAt).toLocaleString()}
              </span>
              <a
                className="ml-auto text-xs underline"
                href={c.url}
                target="_blank"
                rel="noopener"
              >
                Open original
              </a>
            </div>
            <p className="text-xs">
              Revision: {c.revision} · Fixture: {c.fixture}
            </p>
            <p className="text-xs text-muted-foreground">{c.provenance}</p>
            <p className="break-all font-mono text-[10px] text-muted-foreground">
              SHA-256 {c.hash}
            </p>
            <a
              className="inline-block text-xs underline"
              href={`/api/evidence?capture=${c.id}`}
              target="_blank"
              rel="noopener"
            >
              Checks for this capture
            </a>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}
