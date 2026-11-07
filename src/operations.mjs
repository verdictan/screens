import { prepareDiff } from "./diff.mjs";
import { preparePreview } from "./previews.mjs";

export async function mutate(store, operation, input, idempotencyKey) {
  const replay = store.replay(idempotencyKey, operation, input);
  if (replay) return replay;
  let diff;
  if (operation === "capture") {
    const bytes = input.bytes || Buffer.from(input.imageBase64 || "", "base64");
    await preparePreview(store, bytes);
  }
  if (operation === "diff") diff = await prepareDiff(store, input);
  const result = store.once(idempotencyKey, operation, input, () => {
    switch (operation) {
      case "project": return store.project(input);
      case "screen": return store.screen(input);
      case "capture": return store.capture(input);
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
