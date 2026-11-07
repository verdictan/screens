import { useEffect, useRef, useState } from "react";
import { thumbHashToRGBA } from "thumbhash";

export function CaptureImage({ capture, alt, onLoad, onError, onClick, style, loading = "eager", className = "" }) {
  const canvas = useRef(null);
  const image = useRef(null);
  const [loaded, setLoaded] = useState(null);
  const [failed, setFailed] = useState(null);
  const preview = capture.preview;
  useEffect(() => {
    if (!preview?.thumbhash || !canvas.current) return;
    const bytes = Uint8Array.from(atob(preview.thumbhash), (c) => c.charCodeAt(0));
    const { w, h, rgba } = thumbHashToRGBA(bytes);
    canvas.current.width = w;
    canvas.current.height = h;
    canvas.current.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  }, [preview?.thumbhash, capture.id]);
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth) setLoaded(capture.id);
  }, [capture.id]);
  return (
    <span className={`capture-image-frame ${className}`} style={{
      "--image-ratio": preview ? preview.width / preview.height : 1,
      aspectRatio: preview ? `${preview.width} / ${preview.height}` : undefined,
      ...style,
    }} data-loaded={loaded === capture.id}>
      <canvas ref={canvas} aria-hidden="true" className="capture-placeholder" />
      <img ref={image} loading={loading} src={capture.url} alt={alt} width={preview?.width} height={preview?.height}
        className="capture-image" onClick={onClick}
        onLoad={(event) => { setLoaded(capture.id); onLoad?.(event); }}
        onError={() => { setFailed(capture.id); onError?.(); }} />
      {failed === capture.id && <span className="image-error" role="status">Image could not be loaded</span>}
    </span>
  );
}
