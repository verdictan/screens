import { prepareDiff } from "./diff.mjs";
import { preparePreview } from "./previews.mjs";

export async function mutate(store, operation, input, idempotencyKey) {
  const replay = store.replay(idempotencyKey, operation, input);
  if (replay) return replay;
  let diff;
  if (["capture", "capture.attach"].includes(operation)) {
    const bytes = input.bytes || Buffer.from(input.imageBase64 || "", "base64");
    await preparePreview(store, bytes);
  }
  if (operation === "diff") diff = await prepareDiff(store, input);
  const result = store.once(idempotencyKey, operation, input, () => {
    switch (operation) {
      case "project": return store.project(input);
      case "screen": return store.screen(input);
      case "capture": return store.capture(input);
      case "capture.attach": {
        const previous = store.getRun(input.run);
        const capture = store.capture(input);
        const ids = previous.captureIds.filter(id => {
          const item = store.getCapture(id);
          return item.screen !== capture.screen || item.role !== capture.role || JSON.stringify(item.variant) !== JSON.stringify(capture.variant);
        });
        return store.run({ project: previous.project, title: input.title, captureIds: [...ids, capture.id], source: { kind: "upload", previous: previous.id }, warnings: previous.warnings });
      }
      case "run": return store.run(input);
      case "review-set": return store.saveReviewSet(input);
      case "note": return store.addNote(input);
      case "note.update": return store.updateNote(input, { human: true });
      case "note.submit": return store.updateNote({ ...input, status: "submitted" });
      case "target": return store.approveTarget(input);
      case "evidence": return store.addEvidence(input);
      case "diff": return store.saveDiff(diff.value, diff.bytes);
      default: throw Error("Unknown operation");
    }
  });
  return result;
}
