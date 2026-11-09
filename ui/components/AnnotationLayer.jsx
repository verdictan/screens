import { useReducer } from "react";
import { annotationGesture, initialGesture, selectionRectangle } from "../lib/workflows";

const bounds = (region) => ({ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` });
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export function AnnotationLayer({ capture, notes, pin, selecting, onSelect, onOpen, onCancel }) {
  const [gesture, dispatch] = useReducer(annotationGesture, initialGesture);
  const selection = gesture.region;
  const position = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };
  const finish = (region) => {
    dispatch({ type: "finish" });
    onSelect({ capture: capture.id, point: null, region });
  };
  return <>
    {notes.map((note, i) => note.region && <button key={note.id} type="button" className="capture-region"
      style={bounds(note.region)} aria-label={`Open area comment ${i + 1}: ${note.text}`} title={note.text}
      onClick={() => onOpen({ capture: capture.id, noteId: note.id, region: note.region, point: null })}><span>{i + 1}</span></button>)}
    {pin?.capture === capture.id && pin.region && <span className="capture-region is-draft" style={bounds(pin.region)} aria-hidden="true"><span>+</span></span>}
    {selecting && <div className="annotation-surface" role="button" tabIndex={0}
      aria-label="Select an area to compare or comment. Drag to select, or press Enter to start, arrows to move, Shift and arrows to resize, Enter to confirm, Escape to cancel."
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        dispatch({ type: "pointer-start", point: position(event), pointer: event.pointerId });
      }}
      onPointerMove={(event) => {
        dispatch({ type: "pointer-move", pointer: event.pointerId, point: position(event) });
      }}
      onPointerUp={(event) => {
        if (gesture.phase !== "dragging" || gesture.pointer !== event.pointerId) return;
        const region = selectionRectangle(gesture.start, position(event));
        const rect = event.currentTarget.getBoundingClientRect();
        dispatch({ type: "finish" });
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (region.width * rect.width >= 4 && region.height * rect.height >= 4) finish(region);
      }}
      onPointerCancel={event => dispatch({ type: "pointer-cancel", pointer: event.pointerId })}
      onLostPointerCapture={event => dispatch({ type: "pointer-cancel", pointer: event.pointerId })}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); dispatch({ type: "cancel" }); onCancel(); return; }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (gesture.phase === "adjusting") finish(selection);
          else dispatch({ type: "keyboard-start" });
          return;
        }
        if (gesture.phase !== "adjusting" || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const dx = event.key === "ArrowLeft" ? -0.01 : event.key === "ArrowRight" ? 0.01 : 0;
        const dy = event.key === "ArrowUp" ? -0.01 : event.key === "ArrowDown" ? 0.01 : 0;
        dispatch({ type: "keyboard-move", dx, dy, resize: event.shiftKey });
      }}>
      {selection && <span className="capture-region is-draft" style={bounds(selection)} aria-hidden="true" />}
    </div>}
  </>;
}
