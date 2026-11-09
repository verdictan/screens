import { feedbackOpen } from "../src/workflows.mjs";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronLeft, ChevronRight, Maximize2, Minimize2, MessageSquare, Plus } from "lucide-react";
import { Button } from "./components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { CaptureIssues } from "./components/CaptureIssues";
import { Comparison } from "./Comparison";
import { Feedback, Evidence, History } from "./ReviewPanels";
import { api } from "./lib/api";
import { shortcutLabel } from "./lib/shortcuts";
import { cn } from "./lib/utils";
import { changeView } from "./lib/motion";

export function Review({ run, entry, detail, perform, previous, next, position, total, tab, setTab, focused, setFocused, loading = false, skeletonVisible = false, onCapture, onNextAttention }) {
  const inspector = useRef(null);
  const [approving, setApproving] = useState(false);
  const [pin, setPin] = useState(null);
  const [areaRequest, setAreaRequest] = useState(null);
  const sameIds = new Set(detail.captures.filter((capture) => JSON.stringify(capture.variant) === JSON.stringify(entry.variant)).map((capture) => capture.id));
  const notes = detail.notes.filter((note) => sameIds.has(note.capture));
  const exactIds = new Set(Object.values(entry.captures).map((capture) => capture.id));
  const evidence = detail.evidence.filter((item) => exactIds.has(item.capture));
  const openNotes = notes.filter((note) => feedbackOpen(note));
  const submitted = notes.filter((note) => note.status === "submitted");
  async function openFeedback(value) {
    setFocused(false);
    if (value && !value.noteId) setPin(value);
    await setTab("feedback");
    requestAnimationFrame(() => {
      const target = value?.noteId ? document.getElementById(`note-${value.noteId}`) : document.getElementById("note-text");
      target?.focus({ preventScroll: true });
      if (value?.noteId) target?.scrollIntoView({ block: "nearest" });
      else if (matchMedia("(max-width: 1100px)").matches) inspector.current?.scrollIntoView({ block: "start" });
    });
  }
  function compareArea(note) {
    setAreaRequest({ capture: note.capture, region: note.region, noteId: note.id });
    document.getElementById("comparison-area")?.scrollIntoView({ block: "start" });
  }
  async function approve() {
    await perform(async () => {
      setApproving(true);
      try {
        const capture = entry.captures.target;
        const previous = detail.targets.find((target) => detail.captures.some((item) => item.id === target.capture && JSON.stringify(item.variant) === JSON.stringify(capture.variant)));
        await api("/api/targets/approve", { capture: capture.id, expectedRevision: previous?.revision ?? 0 });
      } finally { setApproving(false); }
    }, "Design approved");
  }
  return (
    <div id="review" className={cn("review", focused && "review-focused", loading && "is-loading")}
      data-visible={skeletonVisible} aria-busy={loading} aria-label={loading ? "Loading screen" : undefined} inert={loading}>
      <header className="review-heading">
        <div className="review-title">
          <h1 id="title" title={entry.title}>{entry.title}</h1>
          <div className="screen-context">
            <span>{entry.variant.device}</span>
            {entry.variant.theme !== "unspecified" && <span>{entry.variant.theme}</span>}
            <Collapsible className="screen-information">
              <CollapsibleTrigger>Details</CollapsibleTrigger><CollapsibleContent>
              <dl><dt>Viewport</dt><dd>{entry.variant.viewport}</dd><dt>Language</dt><dd>{entry.variant.locale}</dd><dt>Text scale</dt><dd>{entry.variant.textScale || "Default"}</dd></dl>
            </CollapsibleContent></Collapsible>
          </div>
        </div>
        <div className="screen-navigation">
          {position > 0 && <span className="screen-position">{position} <span>of {total}</span></span>}
          <Button id="previous" shortcut="ArrowLeft" aria-label="Previous screen" variant="ghost" size="icon" disabled={!previous} onClick={previous}><ChevronLeft /></Button>
          <Button id="next" shortcut="ArrowRight" aria-label="Next screen" variant="ghost" size="icon" disabled={!next} onClick={next}><ChevronRight /></Button>
          <Button className="focus-button" variant="secondary" size="sm" aria-pressed={focused} aria-label={focused ? "Show review panel" : "Focus on screenshots"} onClick={() => changeView(() => setFocused(!focused))}>
            {focused ? <Minimize2 /> : <Maximize2 />}<span>{focused ? "Show review" : "Focus"}</span>
          </Button>
        </div>
      </header>
      <Button className="review-jump" variant="secondary" onClick={() => setTab(openNotes.length ? "feedback" : "compare")}>
        <MessageSquare /><span>{openNotes.length ? `Review feedback (${openNotes.length})` : "Open review panel"}</span><ArrowDown />
      </Button>
      <div className="review-layout" data-section={tab}>
        <section className="review-canvas" aria-label="Screen comparison" data-page="compare">
          <Comparison {...{ entry, detail, perform, loading, pin, areaRequest }} onPin={openFeedback} />
          <CaptureIssues groups={run.problems} missing={run.uncoveredScreens} onCapture={onCapture} />
        </section>
        <aside id="review-panel" ref={inspector} className="review-inspector" aria-label="Review panel" hidden={focused} inert={focused}>
          <Button className="comparison-jump" variant="ghost" onClick={() => document.getElementById("review")?.scrollIntoView({ block: "start" })}><ArrowUp />Back to screenshots</Button>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Review sections">
              <TabsTrigger value="compare" title={shortcutLabel("Alt+1")} data-shortcut="Alt+1">Review</TabsTrigger>
              <TabsTrigger value="feedback" title={shortcutLabel("Alt+2")} data-shortcut="Alt+2">Feedback{notes.length > 0 && <span className="tab-count">{notes.length}</span>}</TabsTrigger>
              <TabsTrigger value="evidence" title={shortcutLabel("Alt+3")} data-shortcut="Alt+3">Evidence</TabsTrigger>
              <TabsTrigger value="history" title={shortcutLabel("Alt+4")} data-shortcut="Alt+4">History</TabsTrigger>
            </TabsList>
            <TabsContent value="compare" inert={tab !== "compare"}>
              <div className="review-summary">
                <h2>{submitted.length ? "Review the submitted fix" : openNotes.length ? "Resolve open feedback" : entry.targetApproval ? "Design reference approved" : entry.captures.target ? "Choose the design reference" : "Leave your first comment"}</h2>
                <p>{submitted.length ? "Review the update and verify the fix in Feedback." : openNotes.length ? `${openNotes.length} ${openNotes.length === 1 ? "note needs" : "notes need"} attention.` : entry.targetApproval ? "Compare the implementation with the approved design." : entry.captures.target ? "Use the design as your reference, then comment on differences." : "Select a point or area on the screenshot and describe what should change."}</p>
                {submitted.length > 0 ? <Button onClick={() => openFeedback()}><MessageSquare />Review feedback</Button> : <Button variant={entry.captures.target && !entry.targetApproval ? "secondary" : "default"} onClick={() => openFeedback()}><Plus />Leave feedback</Button>}
                <div className="design-decision">
                  <h3>Design reference</h3>
                  {entry.captures.target ? <>
                    <p>{entry.targetApproval ? "This is the approved reference for this screen." : "Approve this as the reference for implementation."}</p>
                    {!entry.targetApproval && <Button id="approve" variant={submitted.length ? "secondary" : "default"} aria-busy={approving} disabled={approving} onClick={approve}>{approving ? "Approving…" : "Approve design"}<Check /></Button>}
                    <a href={entry.captures.target.url} target="_blank" rel="noopener">Open design original<ArrowUpRight /></a>
                  </> : <><p>Add a screenshot to compare against the implementation.</p><Button variant="secondary" onClick={() => onCapture?.("target")}>Add design reference</Button></>}
                </div>
                {onNextAttention && <Button variant="ghost" onClick={onNextAttention}>Next screen needing review<ChevronRight /></Button>}
                <div className="review-facts">
                  <Button variant="ghost" onClick={() => openFeedback()}><span>Open feedback</span><strong>{openNotes.length}</strong><ChevronRight /></Button>
                  <Button variant="ghost" onClick={() => setTab("evidence")}><span>Recorded evidence</span><strong>{evidence.length}</strong><ChevronRight /></Button>
                  <Button variant="ghost" onClick={() => setTab("history")}><span>Screenshot history</span><strong>{detail.captures.length}</strong><ChevronRight /></Button>
                </div>
                <p className="review-footnote">Approving a design does not verify a fix.</p>
              </div>
            </TabsContent>
            <TabsContent value="feedback" inert={tab !== "feedback"}><Feedback {...{ entry, notes, pin, setPin, perform }} onCompareArea={compareArea} /></TabsContent>
            <TabsContent value="evidence" inert={tab !== "evidence"}><Evidence {...{ entry, evidence, perform }} /></TabsContent>
            <TabsContent value="history" inert={tab !== "history"}><History detail={detail} /></TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
