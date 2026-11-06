import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ScanLine, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { api, labels } from "@/lib/api";
import { Field, Notice } from "./App";
export function Comparison({ entry, detail, onPin, perform }) {
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
  const requestKey = JSON.stringify({
      left: left?.id,
      right: right?.id,
      threshold,
      masks,
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
        JSON.stringify(d.masks) === JSON.stringify(masks),
    );
  useEffect(() => {
    if (view !== "overlay" || !left || !right) return;
    const a = dimensions[left.id],
      b = dimensions[right.id];
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
      ? "Comparison incomplete · a capture is missing."
      : left.fixture !== right.fixture
        ? "Fixture mismatch · review with caution."
        : /unknown|unspecified/.test(left.fixture)
          ? "Fixture fidelity is unknown."
          : left.hash === right.hash
            ? "These captures have identical file bytes."
            : "Visual review required.";
  function panel(role) {
    const capture = entry.captures[role];
    return (
      <Card key={role} className="capture-panel">
        <div className="capture-header">
          <h3 className="text-sm font-semibold">{labels[role]}</h3>
          <Badge variant="outline">
            {role === "target"
              ? entry.targetApproval
                ? "Approved"
                : "Proposed"
              : capture?.revision === "unknown"
                ? "Revision unknown"
                : capture?.revision.slice(0, 8) || "Missing"}
          </Badge>
        </div>
        {!capture ? (
          <div className="flex min-h-64 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            No {role} capture in this run. Missing evidence does not imply a
            match.
          </div>
        ) : (
          <>
            <div className="capture-stage">
              <div className="capture-image-anchor">
                <img
                  src={capture.url}
                  alt={`${entry.title} — ${labels[role]}`}
                  className="capture-image"
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
                />
                {detail.notes
                  .filter((n) => n.capture === capture.id && n.point)
                  .map((n, i) => (
                    <button
                      key={n.id}
                      title={n.text}
                      aria-label={`Feedback: ${n.text}`}
                      className="absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-primary text-xs text-white shadow"
                      style={{
                        left: `${n.point.x * 100}%`,
                        top: `${n.point.y * 100}%`,
                      }}
                      onClick={() =>
                        onPin({ capture: capture.id, point: n.point })
                      }
                    >
                      {i + 1}
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
          </>
        )}
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <div className="comparison-toolbar">
        <div
          className="flex max-w-full flex-wrap gap-1"
          role="group"
          aria-label="Comparison"
        >
          {[
            ["current,pr", "Current / PR"],
            ["target,pr", "Target / PR"],
            ["current,target", "Current / Target"],
          ].map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={pair === value ? "outline" : "ghost"}
              aria-pressed={pair === value}
              onClick={() => {
                setPair(value);
                setWarning("");
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Field label={<span className="sr-only">View</span>}>
            <NativeSelect
              aria-label="View"
              value={view}
              onChange={(e) => setView(e.target.value)}
            >
              <option value="side">Side by side</option>
              <option value="overlay">Overlay</option>
                <option value="left">{labels[roles[0]]} only</option>
                <option value="right">{labels[roles[1]]} only</option>
            </NativeSelect>
          </Field>
          {view === "overlay" && left && right && (
            <Field label={`Blend ${blend}%`}>
              <input
                aria-label="Blend"
                type="range"
                min="0"
                max="100"
                value={blend}
                onChange={(e) => setBlend(Number(e.target.value))}
              />
            </Field>
          )}
        </div>
      </div>
      {warning && <Notice>{warning}</Notice>}
      <div
        id="comparison"
        className={
          view === "overlay" && left && right
            ? "overlay-stage"
            : `comparison-grid ${view === "left" || view === "right" ? "comparison-single" : ""}`
        }
      >
        {view === "overlay" && left && right ? (
          <div className="relative mx-auto w-fit max-w-full">
            <img
              src={left.url}
              alt={labels[roles[0]]}
              className="block max-h-[650px] max-w-full"
              onLoad={(e) => imageLoaded(left, e)}
            />
            <img
              src={right.url}
              alt={labels[roles[1]]}
              className="absolute inset-0 h-full w-full"
              style={{ opacity: blend / 100 }}
              onLoad={(e) => imageLoaded(right, e)}
            />
          </div>
        ) : (
          (view === "left" ? [roles[0]] : view === "right" ? [roles[1]] : roles).map(panel)
        )}
      </div>
      <p className="text-xs text-muted-foreground">{status}</p>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 py-4">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ScanLine className="size-4" />
              Pixel differences
            </CardTitle>
            <CardDescription className="text-xs">
              Compare original pixels, with explicit tolerance and exclusions.
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
                  });
                  if (current.current === key)
                    setResult({ key, diff: measured });
                } finally {
                  setBusy(false);
                }
              })
            }
          >
            {busy ? "Measuring…" : "Measure selected pair"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <details>
            <summary className="text-xs font-medium text-muted-foreground">
              Tolerance and excluded regions
            </summary>
            <div className="mt-4 space-y-4">
              <Field label="Channel tolerance (0–255)" className="max-w-44">
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
                    label={
                      { x: "Left", y: "Top", width: "Width", height: "Height" }[
                        k
                      ]
                    }
                    className="w-20"
                  >
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
                  disabled={!masks.length}
                  onClick={() => setMasks([])}
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
          </details>
          <div id="diff-result" aria-live="polite">
            {!diff ? (
              <p className="text-sm text-muted-foreground">
                Not measured for this pair.
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
                  <details>
                    <summary className="text-xs font-medium">
                      Show difference map
                    </summary>
                    <p className="my-2 text-xs text-muted-foreground">
                      Pink: changed · Blue: excluded
                    </p>
                    <a
                      href={diff.url}
                      target="_blank"
                      rel="noopener"
                      className="block rounded-lg border bg-muted/30 p-3"
                    >
                      <img
                        src={diff.url}
                        alt="Pixel difference map"
                        className="mx-auto max-h-[450px] max-w-full"
                      />
                    </a>
                  </details>
                )}
                <details>
                  <summary className="text-xs text-muted-foreground">
                    Measurement provenance
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-[11px]">
                    {JSON.stringify(diff, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
