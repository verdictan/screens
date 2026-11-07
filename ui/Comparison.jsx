import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ScanLine, Scan, Plus, MessageSquare, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { api, labels } from "@/lib/api";
import { Field, FieldLabel } from "./components/ui/field";
import { Alert, AlertDescription } from "./components/ui/alert";
import { AnnotationLayer } from "./components/AnnotationLayer";
import { RegionComparison } from "./components/RegionComparison";
import { CaptureImage } from "./components/CaptureImage";
import { changeView } from "./lib/motion";
import { useUndo } from "./lib/undo";
export function Comparison({ entry, detail, onPin, perform, loading = false, pin, areaRequest }) {
  const waitForUndo = useUndo();
  const [selectingArea, setSelectingArea] = useState(false);
  const [selectedArea, setSelectedArea] = useState(null);
  const [comparingArea, setComparingArea] = useState(false);
  const [maskUndoPending, setMaskUndoPending] = useState(false);
  const [pair, setPair] = useState(
    entry.captures.pr
      ? entry.captures.target
        ? "target,pr"
        : "current,pr"
      : "current,target",
  );
  const [view, setView] = useState("side"),
    [blend, setBlend] = useState(50),
    [dimensions, setDimensions] = useState({}),
    [warning, setWarning] = useState("");
  const [threshold, setThreshold] = useState(0),
    [masks, setMasks] = useState([]),
    [rectangle, setRectangle] = useState({ x: 0, y: 0, width: 1, height: 1 }),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(null);
  const roles = pair.split(","),
    [left, right] = roles.map((r) => entry.captures[r]);
  useEffect(() => {
    if (!areaRequest) return;
    const candidates = [pair, "current,target", "target,pr", "current,pr"];
    const next = candidates.find((candidate) => {
      const captures = candidate.split(",").map((role) => entry.captures[role]);
      return captures.every(Boolean) && captures.some((capture) => capture.id === areaRequest.capture);
    });
    if (next) { setPair(next); setComparingArea(true); }
    else { setComparingArea(false); setWarning("Add a second screenshot to compare this area."); }
    setSelectedArea(areaRequest);
    setSelectingArea(false);
    setView("side");
  }, [areaRequest]);
  const region = comparingArea && [left?.id, right?.id].includes(selectedArea?.capture) ? selectedArea.region : null;
  const areaNotes = detail.notes.filter((note) => note.region && [left?.id, right?.id].includes(note.capture));
  function openAnnotation(value) {
    if (value.region) setSelectedArea(value);
    onPin(value);
  }
  const requestKey = JSON.stringify({
      left: left?.id,
      right: right?.id,
      threshold,
      masks,
      region,
    }),
    current = useRef(requestKey);
  current.current = requestKey;
  useEffect(
    () => () => {
      current.current = null;
    },
    [],
  );
  const diff =
    (result?.key === requestKey ? result.diff : null) ||
    entry.measurements?.find(
      (d) =>
        d.left === left?.id &&
        d.right === right?.id &&
        d.threshold === threshold &&
        JSON.stringify(d.masks) === JSON.stringify(masks) &&
        JSON.stringify(d.region || null) === JSON.stringify(region),
    );
  useEffect(() => {
    if (view !== "overlay" || !left || !right) return;
    const a = dimensions[left.id] || left.preview,
      b = dimensions[right.id] || right.preview;
    if (a && b && (a.width !== b.width || a.height !== b.height)) {
      setView("side");
      setWarning(
        "Overlay requires equal pixel dimensions. No resizing was applied.",
      );
    }
  }, [view, left?.id, right?.id, dimensions]);
  const imageLoaded = (c, event) => {
    const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
    setDimensions((d) =>
      d[c.id]?.width === width && d[c.id]?.height === height
        ? d
        : { ...d, [c.id]: { width, height } },
    );
  };
  const status =
    !left || !right
      ? "A screenshot is missing from this comparison."
      : left.fixture !== right.fixture
        ? "These screenshots use different sample data."
        : /unknown|unspecified/.test(left.fixture)
          ? "The screenshot data source is unspecified."
          : left.hash === right.hash
            ? "The original files are identical."
            : view === "overlay"
              ? "Drag to compare. Use Side by side to comment."
              : "Click to comment, or select an area.";
  function panel(role) {
    const capture = entry.captures[role];
    return (
      <figure key={role} className="capture-panel">
        <figcaption className="capture-header">
          <h3 className="text-sm font-semibold">{labels[role]}</h3>
          <Badge variant="outline">
            {!capture ? "Missing" : role === "target"
              ? entry.targetApproval
                ? "Approved"
                : "Proposed"
              : capture?.createdAt
                ? new Date(capture.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                : "No screenshot"}
          </Badge>
        </figcaption>
        {!capture ? (
          <div className="capture-missing"><Images aria-hidden="true" /><h3>No {labels[role].toLowerCase()} screenshot</h3><p>Ask your assistant to add this view to the review.</p></div>
        ) : (
          <>
            <div className="capture-stage">
              <div className="capture-image-anchor" style={{ "--image-ratio": capture.preview ? capture.preview.width / capture.preview.height : 1.5 }}>
                {loading ? <div className="skeleton-image" /> : <CaptureImage
                  key={capture.id}
                  capture={capture}
                  alt={`${entry.title} — ${labels[role]}`}
                  onLoad={(e) => imageLoaded(capture, e)}
                  onError={() =>
                    setWarning("A capture image could not be loaded.")
                  }
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    onPin({
                      capture: capture.id,
                      point: {
                        x: (event.clientX - rect.left) / rect.width,
                        y: (event.clientY - rect.top) / rect.height,
                      },
                    });
                  }}
                />}
                {!loading && <AnnotationLayer key={`${capture.id}-${view}-${selectingArea}`} capture={capture}
                  notes={detail.notes.filter((note) => note.capture === capture.id && (note.point || note.region))}
                  pin={selectedArea || pin} selecting={selectingArea && view !== "overlay"} onCancel={() => setSelectingArea(false)}
                  onOpen={openAnnotation} onSelect={(value) => { setSelectingArea(false); setSelectedArea(value); }} />}
                {pin?.capture === capture.id && pin.point && <span className="capture-pin is-draft" aria-hidden="true" style={{ left: `${pin.point.x * 100}%`, top: `${pin.point.y * 100}%` }}>+</span>}
                {detail.notes
                  .filter((n) => n.capture === capture.id && (n.point || n.region))
                  .map((n, i) => n.point && (
                    <button
                      type="button"
                      key={n.id}
                      title={n.text}
                      aria-label={`Open feedback ${i + 1}: ${n.text}`}
                      onClick={() => onPin({ capture: capture.id, point: n.point, noteId: n.id })}
                      className="capture-pin"
                      style={{
                        left: `${n.point.x * 100}%`,
                        top: `${n.point.y * 100}%`,
                      }}
                    >
                      <span>{i + 1}</span>
                    </button>
                  ))}
              </div>
            </div>
            <div className="capture-footer">
              <span className="truncate" title={capture.fixture}>
                {dimensions[capture.id]
                  ? `${dimensions[capture.id].width} × ${dimensions[capture.id].height}`
                  : capture.variant.viewport}
              </span>
              <Button variant="ghost" size="sm" aria-label={`Leave feedback on ${labels[role].toLowerCase()}`} onClick={() => onPin({ capture: capture.id, point: null })}><MessageSquare /><span>Feedback</span></Button>
              <a
                href={capture.url}
                target="_blank"
                rel="noopener"
                className="flex shrink-0 items-center gap-1 hover:underline"
              >
                Original
                <ArrowUpRight className="size-3" />
              </a>
            </div>
            {detail.notes.some((note) => note.capture === capture.id && (note.point || note.region)) && (
              <Collapsible className="capture-notes">
                <CollapsibleTrigger>Annotation comments</CollapsibleTrigger><CollapsibleContent>
                <div className="capture-notes-list">
                  {detail.notes.filter((note) => note.capture === capture.id && (note.point || note.region)).map((note, i) => (
                    <Button key={note.id} variant="ghost" size="sm" onClick={() => openAnnotation({ capture: capture.id, point: note.point, region: note.region, noteId: note.id })}>
                      {i + 1}. {note.text}
                    </Button>
                  ))}
                </div>
              </CollapsibleContent></Collapsible>
            )}
          </>
        )}
      </figure>
    );
  }
  return (
    <div id="comparison-area" className="comparison">
      <div className="comparison-toolbar">
        <NativeSelect className="pair-picker" aria-label="Comparison pair" value={pair}
          onChange={(event) => { const value = event.target.value; changeView(() => { setPair(value); setWarning(""); setSelectedArea(null); setComparingArea(false); setSelectingArea(false); }); }}>
          <NativeSelectOption value="current,target">Current &amp; design</NativeSelectOption>
          <NativeSelectOption value="target,pr">Design &amp; update</NativeSelectOption>
          <NativeSelectOption value="current,pr">Current &amp; update</NativeSelectOption>
        </NativeSelect>
        <ToggleGroup className="view-controls" type="single" aria-label="Comparison view" value={view === "left" ? "right" : view} onValueChange={(value) => { if (value) changeView(() => setView(value)); }}>
          {[["side", "Side by side"], ["overlay", "Overlay"], ["right", "Single"]].map(([value, label]) => (
            <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="annotation-tools">
        <Button variant={selectingArea ? "secondary" : "ghost"} size="sm" aria-pressed={selectingArea}
          onClick={() => { if (view === "overlay") setView("side"); setComparingArea(false); setSelectingArea(!selectingArea); }}><Scan />{selectingArea ? "Cancel selection" : "Select area"}</Button>
        {areaNotes.length > 0 && <NativeSelect className="area-note-picker" aria-label="Select an annotated area" value={selectedArea?.noteId || ""}
          onChange={(event) => {
            const note = areaNotes.find((note) => note.id === event.target.value);
            if (note) { setSelectedArea({ capture: note.capture, region: note.region, noteId: note.id }); setSelectingArea(false); }
          }}>
          <NativeSelectOption value="">Use an area comment</NativeSelectOption>
          {areaNotes.map((note) => <NativeSelectOption key={note.id} value={note.id}>{labels[Object.keys(entry.captures).find((role) => entry.captures[role].id === note.capture)]}: {note.text}</NativeSelectOption>)}
        </NativeSelect>}
        {selectedArea && <>
          <Button variant="secondary" size="sm" disabled={!left || !right} aria-pressed={comparingArea} onClick={() => { setComparingArea(!comparingArea); setSelectingArea(false); }}>{comparingArea ? "Show full screenshots" : "Compare selected area"}</Button>
          <Button variant="ghost" size="sm" onClick={() => onPin({ capture: selectedArea.capture, region: selectedArea.region, point: null })}>Comment on area</Button>
          <Button variant="ghost" size="sm" onClick={() => { setSelectedArea(null); setComparingArea(false); }}>Clear area</Button>
        </>}
        <span role="status">{selectingArea ? "Drag to select, or focus the image and press Enter. Esc cancels." : region ? "Comparing the selected area only" : selectedArea ? "Area selected. Compare it or add a comment." : ""}</span>
      </div>
      {(view === "left" || view === "right") && <div className="comparison-adjustment"><Field ><FieldLabel htmlFor="single-screenshot">Show screenshot</FieldLabel><NativeSelect id="single-screenshot" aria-label="Single screenshot" value={view} onChange={(event) => { const value = event.target.value; changeView(() => setView(value)); }}><NativeSelectOption value="left">{labels[roles[0]]}</NativeSelectOption><NativeSelectOption value="right">{labels[roles[1]]}</NativeSelectOption></NativeSelect></Field></div>}
      {view === "overlay" && left && right && <div className="blend-control"><span>{labels[roles[0]]}</span><Slider aria-label="Blend" min={0} max={100} step={1} value={[blend]} onValueChange={([value]) => setBlend(value)} /><span>{labels[roles[1]]}</span><output>{blend}%</output></div>}
      {warning && <Alert className="notice" role="status"><AlertDescription>{warning}</AlertDescription></Alert>}
      {region && left && right && <section aria-label="Selected area comparison">
        <RegionComparison {...{ left, right, roles, region, dimensions, view, blend }} />
      </section>}
      <div
        hidden={Boolean(region)}
        id="comparison"
        className={
          view === "overlay" && left && right
            ? "overlay-stage"
            : `comparison-grid ${view === "left" || view === "right" ? "comparison-single" : ""}`
        }
      >
        {view === "overlay" && left && right ? (
          <div className="overlay-images" style={{ "--image-ratio": left.preview ? left.preview.width / left.preview.height : 1.5 }}>
            <CaptureImage key={left.id} capture={left} alt={labels[roles[0]]}
              onLoad={(e) => imageLoaded(left, e)} onError={() => setWarning("A capture image could not be loaded.")} />
            <CaptureImage key={right.id} capture={right} alt={labels[roles[1]]}
              className="overlay-image" style={{ opacity: blend / 100 }}
              onLoad={(e) => imageLoaded(right, e)} onError={() => setWarning("A capture image could not be loaded.")} />
          </div>
        ) : (
          (view === "left" ? [roles[0]] : view === "right" ? [roles[1]] : roles).map(panel)
        )}
      </div>
      <p className="comparison-hint">{status}</p>
      <Collapsible className="measurement-tools">
        <CollapsibleTrigger><ScanLine /><span>Inspect pixel differences</span>{diff?.status === "measured" && <strong>{(diff.changedRatio * 100).toFixed(2)}% changed</strong>}</CollapsibleTrigger><CollapsibleContent>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 py-4">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ScanLine className="size-4" />
              Pixel differences
            </CardTitle>
            <CardDescription className="text-xs">
              {region ? "Measure changes inside the selected area." : "Measure changes between the two screenshots."}
            </CardDescription>
          </div>
          <Button
            id="measure"
            variant="outline"
            size="sm"
            disabled={!left || !right || busy}
            onClick={() =>
              perform(async () => {
                const key = requestKey;
                setBusy(true);
                try {
                  const measured = await api("/api/diffs", {
                    left: left.id,
                    right: right.id,
                    threshold,
                    masks,
                    ...(region ? { region } : {}),
                  });
                  if (current.current === key)
                    setResult({ key, diff: measured });
                } finally {
                  setBusy(false);
                }
              })
            }
          >
            {busy ? "Measuring…" : region ? "Measure selected area" : "Measure changes"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <Collapsible>
            <CollapsibleTrigger className="text-xs font-medium text-muted-foreground">
              Tolerance and excluded regions
            </CollapsibleTrigger><CollapsibleContent>
            <div className="mt-4 space-y-4">
              <Field  className="max-w-44"><FieldLabel htmlFor="diff-threshold">Channel tolerance (0–255)</FieldLabel>
                <Input
                  id="diff-threshold"
                  type="number"
                  min="0"
                  max="255"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                Enter rectangles in original image pixels. Masked regions do not
                contribute to the score.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                {["x", "y", "width", "height"].map((k) => (
                  <Field
                    key={k}
                    
                    className="w-20"
                  ><FieldLabel htmlFor={`mask-${k}`}>{
                      { x: "Left", y: "Top", width: "Width", height: "Height" }[
                        k
                      ]
                    }</FieldLabel>
                    <Input
                      id={`mask-${k}`}
                      type="number"
                      min={k === "x" || k === "y" ? 0 : 1}
                      value={rectangle[k]}
                      onChange={(e) =>
                        setRectangle({
                          ...rectangle,
                          [k]: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                ))}
                <Button
                  id="add-mask"
                  disabled={maskUndoPending}
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    perform(() => {
                      if (
                        masks.length >= 100 ||
                        !Object.values(rectangle).every(Number.isInteger) ||
                        rectangle.x < 0 ||
                        rectangle.y < 0 ||
                        rectangle.width < 1 ||
                        rectangle.height < 1
                      )
                        throw Error("Enter a valid pixel rectangle.");
                      setMasks([...masks, { ...rectangle }]);
                    })
                  }
                >
                  <Plus />
                  Add region
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!masks.length || maskUndoPending}
                  onClick={async () => {
                    const previous = masks;
                    setMaskUndoPending(true);
                    setMasks([]);
                    try {
                      if (!await waitForUndo("Excluded regions cleared")) setMasks(previous);
                    } finally { setMaskUndoPending(false); }
                  }}
                >
                  Clear
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {masks.length
                  ? masks
                      .map((m) => `(${m.x}, ${m.y}) ${m.width} × ${m.height}`)
                      .join("; ")
                  : "No excluded regions."}
              </p>
            </div>
          </CollapsibleContent></Collapsible>
          <div id="diff-result" aria-live="polite">
            {!diff ? (
              <p className="text-sm text-muted-foreground">
                {region ? "Selected area has not been measured." : "Not measured for this pair."}
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  {diff.status === "dimension-mismatch"
                    ? "Not measured: image dimensions differ."
                    : `${(diff.changedRatio * 100).toFixed(3)}% changed · ${diff.changedPixels.toLocaleString()} / ${diff.comparedPixels.toLocaleString()} compared pixels · ${diff.maskedPixels.toLocaleString()} masked`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Fixture: {diff.fixtureStatus} · Tolerance: {diff.threshold} ·
                  Acceptance not assessed
                </p>
                {diff.url && (
                  <Collapsible>
                    <CollapsibleTrigger className="text-xs font-medium">
                      Show difference map
                    </CollapsibleTrigger><CollapsibleContent>
                    <p className="my-2 text-xs text-muted-foreground">
                      Pink: changed · Blue: excluded
                    </p>
                    <a
                      href={diff.url}
                      target="_blank"
                      rel="noopener"
                      className="block rounded-lg bg-muted p-3"
                    >
                      <img
                        src={diff.url}
                        alt="Pixel difference map"
                        className="mx-auto max-h-[450px] max-w-full"
                      />
                    </a>
                  </CollapsibleContent></Collapsible>
                )}
                <Collapsible>
                  <CollapsibleTrigger className="text-xs text-muted-foreground">
                    Measurement provenance
                  </CollapsibleTrigger><CollapsibleContent>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-[11px]">
                    {JSON.stringify(diff, null, 2)}
                  </pre>
                </CollapsibleContent></Collapsible>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      </CollapsibleContent></Collapsible>
    </div>
  );
}
