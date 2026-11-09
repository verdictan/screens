import { useLayoutEffect, useReducer, useRef } from "react";
import { ArrowUp, ArrowDown, Plus, Pencil, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldLabel, FieldSet } from "./ui/field";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { Alert, AlertDescription } from "./ui/alert";
import { reviewSetEditor, initialReviewSet } from "../lib/workflows";
import { api, entryKey } from "../lib/api";

export function ReviewSets({ run, sets, active, onSelect }) {
  const [editor, dispatch] = useReducer(reviewSetEditor, initialReviewSet);
  const { draft, latest, error, phase } = editor;
  const busy = ["saving", "loading-latest"].includes(phase);
  const request = useRef(0), inFlight = useRef(false);
  useLayoutEffect(() => () => { request.current++; }, []);
  const entries = new Map(run.entries.map((entry) => [entryKey(entry), entry]));
  const variantLabel = ({ variant }) => [variant.device, variant.viewport, variant.theme, variant.locale, variant.browser,
    variant.textScale !== "default" ? `Text ${variant.textScale}` : null].filter(Boolean).join(" · ");
  const label = (key) => {
    const entry = entries.get(key);
    return `${entry.title} · ${variantLabel(entry)}`;
  };
  function edit(value) { if (inFlight.current) return; request.current++; dispatch({ type: "open", value }); }
  function close() { if (!busy && !inFlight.current) { request.current++; dispatch({ type: "close" }); } }
  function change(patch) { dispatch({ type: "change", patch }); }
  function move(index, offset) {
    const entries = [...draft.entries];
    [entries[index], entries[index + offset]] = [entries[index + offset], entries[index]];
    change({ entries });
  }
  async function save(event) {
    event.preventDefault();
    if (phase !== "editing" || inFlight.current) return;
    const token = ++request.current; inFlight.current = true; dispatch({ type: "save" });
    try {
      const saved = await api("/api/review-sets", { id: draft.id, run: run.id, title: draft.title, entries: draft.entries, expectedRevision: draft.revision });
      if (request.current !== token) return;
      dispatch({ type: "saved" }); onSelect(saved.id);
    } catch (error) { if (request.current === token) dispatch({ type: "failure", error }); }
    finally { if (request.current === token) inFlight.current = false; }
  }
  async function loadLatest() {
    if (phase !== "conflict" || inFlight.current) return;
    const token = ++request.current; inFlight.current = true; dispatch({ type: "load-latest" });
    try {
      const values = await api(`/api/review-sets?run=${encodeURIComponent(run.id)}`);
      const value = values.find(value => value.id === draft.id);
      if (!value) throw Error("This saved set is no longer available. Your draft is still shown below.");
      if (request.current === token) dispatch({ type: "latest", value });
    } catch (error) { if (request.current === token) dispatch({ type: "failure", error }); }
    finally { if (request.current === token) inFlight.current = false; }
  }
  return <div className="review-set-picker">
    <Field><FieldLabel className="sr-only" htmlFor="review-set">Review set</FieldLabel>
      <NativeSelect id="review-set" value={active?.id || ""} onChange={(event) => onSelect(event.target.value)}>
        <NativeSelectOption value="">All screens</NativeSelectOption>
        {sets.map((set) => <NativeSelectOption key={set.id} value={set.id}>{set.title} ({set.entries.length})</NativeSelectOption>)}
      </NativeSelect>
    </Field>
    <div className="review-set-actions">
      <Button variant="ghost" size="icon" aria-label="New set" title="New set" onClick={() => edit(null)}><Plus /></Button>
      {active && <Button variant="ghost" size="icon" aria-label="Edit set" title="Edit set" onClick={() => edit(active)}><Pencil /></Button>}
    </div>
    <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="review-set-dialog" closeDisabled={busy}>
        <DialogTitle>{draft?.id ? "Edit review set" : "New review set"}</DialogTitle>
        <DialogDescription>Choose screens from this run and put them in review order.</DialogDescription>
        {draft && <form aria-busy={busy} onSubmit={save}>
          <FieldSet disabled={busy}>
            <Field><FieldLabel htmlFor="review-set-title">Name</FieldLabel><Input id="review-set-title" placeholder="Sign-up flow" required maxLength={500} value={draft.title} onChange={(event) => change({ title: event.target.value })} /></Field>
            <Field><FieldLabel htmlFor="review-set-add">Add a screen</FieldLabel>
              <NativeSelect id="review-set-add" value="" onChange={(event) => { const key = event.target.value; if (key) change({ entries: [...draft.entries, key] }); }}>
                <NativeSelectOption value="">Choose a screen</NativeSelectOption>
                {run.entries.filter((entry) => !draft.entries.includes(entryKey(entry))).map((entry) => <NativeSelectOption key={entryKey(entry)} value={entryKey(entry)}>{label(entryKey(entry))}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
            <ol className="review-set-order" aria-label="Review order">
              {draft.entries.map((key, index) => <li key={key}>
                <span title={label(key)}><strong>{entries.get(key).title}</strong><small>{variantLabel(entries.get(key))}</small></span>
                <Button type="button" variant="ghost" size="icon" aria-label={`Move ${label(key)} earlier`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Move ${label(key)} later`} disabled={index === draft.entries.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label(key)} from set`} onClick={() => change({ entries: draft.entries.filter((item) => item !== key) })}><X /></Button>
              </li>)}
            </ol>
            {!draft.entries.length && <p className="text-sm text-muted-foreground">Add a screen to start the flow.</p>}
            {error && <Alert><AlertDescription>{error}</AlertDescription></Alert>}
            {phase === "conflict" && <section className="space-y-3" aria-label="Resolve review set conflict">
              <p>Your draft is kept. Review the saved version before choosing which changes to save.</p>
              {latest ? <>
                <p><strong>Saved version: {latest.title}</strong> · Revision {latest.revision}</p>
                <ol className="space-y-1">{latest.entries.map(key => <li key={key}>{label(key)}</li>)}</ol>
                <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => dispatch({ type: "use-saved" })}>Use saved version</Button><Button type="button" variant="secondary" onClick={() => dispatch({ type: "keep-draft" })}>Keep my draft for the next save</Button></div>
              </> : <Button type="button" variant="secondary" onClick={loadLatest}>Load saved version</Button>}
            </section>}
            <div className="review-set-actions"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button type="submit" disabled={!draft.entries.length || !draft.title.trim() || phase !== "editing"}>{phase === "loading-latest" ? "Loading saved version…" : busy ? "Saving…" : "Save set"}</Button></div>
          </FieldSet>
        </form>}
      </DialogContent>
    </Dialog>
  </div>;
}
