import { useState } from "react";
import { ArrowUp, ArrowDown, Plus, Pencil, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldLabel, FieldSet } from "./ui/field";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { Alert, AlertDescription } from "./ui/alert";
import { api, entryKey } from "../lib/api";

export function ReviewSets({ run, sets, active, onSelect }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const entries = new Map(run.entries.map((entry) => [entryKey(entry), entry]));
  const variantLabel = ({ variant }) => [variant.device, variant.viewport, variant.theme, variant.locale, variant.browser,
    variant.textScale !== "default" ? `Text ${variant.textScale}` : null].filter(Boolean).join(" · ");
  const label = (key) => {
    const entry = entries.get(key);
    return `${entry.title} · ${variantLabel(entry)}`;
  };
  function edit(value) {
    setError("");
    setDraft(value ? { ...value, entries: [...value.entries] } : { title: "", entries: [], revision: 0 });
  }
  function move(index, offset) {
    setDraft((current) => {
      const entries = [...current.entries];
      [entries[index], entries[index + offset]] = [entries[index + offset], entries[index]];
      return { ...current, entries };
    });
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
    <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open && !busy) setDraft(null); }}>
      <DialogContent className="review-set-dialog" closeDisabled={busy}>
        <DialogTitle>{draft?.id ? "Edit review set" : "New review set"}</DialogTitle>
        <DialogDescription>Choose screens from this run and put them in review order.</DialogDescription>
        {draft && <form aria-busy={busy} onSubmit={async (event) => {
          event.preventDefault(); setBusy(true); setError("");
          try {
            const saved = await api("/api/review-sets", { id: draft.id, run: run.id, title: draft.title, entries: draft.entries, expectedRevision: draft.revision });
            onSelect(saved.id); setDraft(null);
          } catch (error) { setError(error.message); }
          finally { setBusy(false); }
        }}>
          <FieldSet disabled={busy}>
            <Field><FieldLabel htmlFor="review-set-title">Name</FieldLabel><Input id="review-set-title" placeholder="Sign-up flow" required maxLength={500} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field>
            <Field><FieldLabel htmlFor="review-set-add">Add a screen</FieldLabel>
              <NativeSelect id="review-set-add" value="" onChange={(event) => { const key = event.target.value; if (key) setDraft({ ...draft, entries: [...draft.entries, key] }); }}>
                <NativeSelectOption value="">Choose a screen</NativeSelectOption>
                {run.entries.filter((entry) => !draft.entries.includes(entryKey(entry))).map((entry) => <NativeSelectOption key={entryKey(entry)} value={entryKey(entry)}>{label(entryKey(entry))}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
            <ol className="review-set-order" aria-label="Review order">
              {draft.entries.map((key, index) => <li key={key}>
                <span title={label(key)}><strong>{entries.get(key).title}</strong><small>{variantLabel(entries.get(key))}</small></span>
                <Button type="button" variant="ghost" size="icon" aria-label={`Move ${label(key)} earlier`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Move ${label(key)} later`} disabled={index === draft.entries.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label(key)} from set`} onClick={() => setDraft({ ...draft, entries: draft.entries.filter((item) => item !== key) })}><X /></Button>
              </li>)}
            </ol>
            {!draft.entries.length && <p className="text-sm text-muted-foreground">Add a screen to start the flow.</p>}
            {error && <Alert><AlertDescription>{error}</AlertDescription></Alert>}
            <div className="review-set-actions"><Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button><Button type="submit" disabled={!draft.entries.length || !draft.title.trim() || busy}>{busy ? "Saving…" : "Save set"}</Button></div>
          </FieldSet>
        </form>}
      </DialogContent>
    </Dialog>
  </div>;
}
