import { useEffect, useRef, useReducer } from "react";
import { thumbHashToRGBA } from "thumbhash";
import { imageFlow } from "../lib/workflows";
import { useDelayedLoading } from "../lib/api";

export function CaptureImage({ capture, alt, onLoad, onError, onClick, style, loading = "eager", className = "" }) {
  const canvas = useRef(null);
  const image = useRef(null);
  const identity = `${capture.id}|${capture.url}`;
  const [state, dispatch] = useReducer(imageFlow, { identity, phase: "loading" });
  const phase = state.identity === identity ? state.phase : "loading";
  const preview = capture.preview;
  const pending = phase === "loading";
  const showLoading = useDelayedLoading(pending && loading !== "lazy", capture.id);
  useEffect(() => {
    if (preview?.thumbhash) {
      const bytes = Uint8Array.from(atob(preview.thumbhash), (c) => c.charCodeAt(0));
      const { w, h, rgba } = thumbHashToRGBA(bytes);
      canvas.current.width = w;
      canvas.current.height = h;
      canvas.current.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    }
  }, [preview?.thumbhash, capture.id]);
  useEffect(() => {
    dispatch({ type: "reset", identity });
    if (image.current?.complete && image.current.currentSrc) {
      if (image.current.naturalWidth) {
        dispatch({ type: "loaded", identity }); onLoad?.({ currentTarget: image.current });
      } else { dispatch({ type: "failed", identity }); onError?.(); }
    }
  }, [identity]);
  return (
    <span className={`capture-image-frame ${className}`} style={{
      "--image-ratio": preview ? preview.width / preview.height : 1,
      aspectRatio: preview ? `${preview.width} / ${preview.height}` : undefined,
      ...style,
    }} data-loaded={phase === "loaded"} aria-busy={pending}>
      <canvas ref={canvas} aria-hidden="true" className="capture-placeholder" />
      <img ref={image} loading={loading} src={capture.url} alt={alt} width={preview?.width} height={preview?.height}
        className="capture-image" onClick={onClick}
        onLoad={(event) => { dispatch({ type: "loaded", identity }); onLoad?.(event); }}
        onError={() => { dispatch({ type: "failed", identity }); onError?.(); }} />
      {showLoading && <span className="image-loading" role="status">Loading screenshot…</span>}
      {phase === "failed" && <span className="image-error" role="status">Image could not be loaded</span>}
    </span>
  );
}
