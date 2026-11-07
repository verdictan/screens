import { useRef, useState } from "react";

const bounds = (region) => ({ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` });
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export function AnnotationLayer({ capture, notes, pin, selecting, onSelect, onOpen, onCancel }) {
  const drag = useRef(null);
  const [selection, setSelection] = useState(null);
  const position = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };
  const rectangle = (start, end) => ({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });
  const finish = (region) => {
    drag.current = null;
    setSelection(null);
    onSelect({ capture: capture.id, point: null, region });
  };
  return <>
    {notes.map((note, i) => note.region && <button key={note.id} type="button" className="capture-region"
      style={bounds(note.region)} aria-label={`Open area comment ${i + 1}: ${note.text}`} title={note.text}
      onClick={() => onOpen({ capture: capture.id, noteId: note.id })}><span>{i + 1}</span></button>)}
    {pin?.capture === capture.id && pin.region && <span className="capture-region is-draft" style={bounds(pin.region)} aria-hidden="true"><span>+</span></span>}
    {selecting && <div className="annotation-surface" role="button" tabIndex={0}
      aria-label="Select an area for a comment. Drag to select, or press Enter to start, arrows to move, Shift and arrows to resize, Enter to confirm, Escape to cancel."
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { start: position(event), pointer: event.pointerId };
        setSelection(null);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointer === event.pointerId) setSelection(rectangle(drag.current.start, position(event)));
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        const region = rectangle(drag.current.start, position(event));
        const rect = event.currentTarget.getBoundingClientRect();
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (region.width * rect.width >= 4 && region.height * rect.height >= 4) finish(region);
        else setSelection(null);
      }}
      onPointerCancel={() => { drag.current = null; setSelection(null); }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); drag.current = null; setSelection(null); onCancel(); return; }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (selection) finish(selection);
          else setSelection({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
          return;
        }
        if (!selection || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const dx = event.key === "ArrowLeft" ? -0.01 : event.key === "ArrowRight" ? 0.01 : 0;
        const dy = event.key === "ArrowUp" ? -0.01 : event.key === "ArrowDown" ? 0.01 : 0;
        setSelection(event.shiftKey
          ? { ...selection, width: clamp(selection.width + dx, 0.01, 1 - selection.x), height: clamp(selection.height + dy, 0.01, 1 - selection.y) }
          : { ...selection, x: clamp(selection.x + dx, 0, 1 - selection.width), y: clamp(selection.y + dy, 0, 1 - selection.height) });
      }}>
      {selection && <span className="capture-region is-draft" style={bounds(selection)} aria-hidden="true" />}
    </div>}
  </>;
}
