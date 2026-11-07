import { labels } from "../lib/api";

export function RegionComparison({ left, right, roles, region, dimensions, view, blend }) {
  function crop(capture, index, overlay = false) {
    const size = dimensions[capture.id] || capture.preview;
    if (!size) return <p role="status">Loading selected area…</p>;
    const x = Math.floor(region.x * size.width), y = Math.floor(region.y * size.height);
    const width = Math.min(size.width, Math.ceil((region.x + region.width) * size.width)) - x;
    const height = Math.min(size.height, Math.ceil((region.y + region.height) * size.height)) - y;
    return <svg className={overlay ? "region-preview region-preview-overlay" : "region-preview"}
      style={overlay ? { opacity: blend / 100 } : undefined}
      viewBox={`${x} ${y} ${width} ${height}`} width={width} height={height} role="img"
      aria-label={`${labels[roles[index]]}, selected area`}>
      <image href={capture.url} width={size.width} height={size.height} />
    </svg>;
  }
  if (view === "overlay") return <div className="region-overlay">{crop(left, 0)}{crop(right, 1, true)}</div>;
  return <div className={`comparison-grid ${view === "left" || view === "right" ? "comparison-single" : ""}`}>
    {[left, right].map((capture, index) => (view === "left" && index === 1 || view === "right" && index === 0) ? null :
      <figure key={capture.id} className="capture-panel">
        <figcaption className="capture-header"><h3>{labels[roles[index]]} · Selected area</h3></figcaption>
        <div className="region-stage">{crop(capture, index)}</div>
      </figure>)}
  </div>;
}
