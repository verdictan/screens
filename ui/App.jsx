import { toast } from "sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import React, { useEffect, useRef, useState } from "react";
import { Layers, Search, Check, Images, Copy, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { NativeSelect, NativeSelectOption } from "./components/ui/native-select";
import { Alert, AlertDescription } from "./components/ui/alert";
import { CaptureImage } from "./components/CaptureImage";
import { CommandMenu, collectActions } from "./components/CommandMenu";
import { Review } from "./Review";
import { ReviewSets } from "./components/ReviewSets";
import { api, useResource, useDelayedLoading, refreshResources, entryKey } from "./lib/api";
import { cn } from "./lib/utils";
import { changeView, useSpring } from "./lib/motion";
import { matchesShortcut, shortcutLabel, typing } from "./lib/shortcuts";

export function App() {
  const shell = useRef(null);
  const [tab, setTab] = useState("compare");
  const [focused, setFocused] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commands, setCommands] = useState([]);
  const [mobile, setMobile] = useState(() => matchMedia("(max-width: 760px)").matches);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const params = new URLSearchParams(location.search);
  const [projectId, setProjectId] = useState(params.get("project") || "");
  const [runId, setRunId] = useState(params.get("run") || "");
  const [setId, setSetId] = useState(params.get("set") || "");
  const [selected, setSelected] = useState(() => {
    try {
      return decodeURIComponent(location.hash.slice(1));
    } catch {
      return "";
    }
  });
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [menu, setMenu] = useState(false),
    [message, setMessage] = useState("");
  useSpring(shell, "--library-progress", mobile ? Number(menu) : Number(!collapsed));
  const projects = useResource("/api/projects");
  const allScreens = useResource("/api/screens");
  const project =
    projects.data?.find((p) => p.id === projectId) || projects.data?.[0];
  const runs = useResource(
    project ? `/api/runs?project=${encodeURIComponent(project.id)}` : null,
  );
  const chosenRun = runs.data?.find((r) => r.id === runId) || runs.data?.[0];
  const comparison = useResource(
    chosenRun ? `/api/compare?run=${chosenRun.id}` : null,
  );
  const run = comparison.data;
  const reviewSets = useResource(chosenRun ? `/api/review-sets?run=${encodeURIComponent(chosenRun.id)}` : null);
  const activeSet = reviewSets.data?.find((set) => set.id === setId);
  const setEntries = activeSet
    ? activeSet.entries.map((key) => run?.entries.find((entry) => entryKey(entry) === key)).filter(Boolean)
    : run?.entries || [];
  const chooseSet = (id) => { setSetId(id); setSelected(""); setQuery(""); setFilter("all"); };
  const entry =
    setEntries.find((e) => entryKey(e) === selected) || setEntries[0];
  const detail = useResource(
    entry ? `/api/screen?id=${encodeURIComponent(entry.screen)}` : null,
  );
  const refresh = () => refreshResources();
  useEffect(() => {
    if (!project) return;
    const u = new URL(location.href);
    u.searchParams.set("project", project.id);
    chosenRun
      ? u.searchParams.set("run", chosenRun.id)
      : u.searchParams.delete("run");
    activeSet ? u.searchParams.set("set", activeSet.id) : u.searchParams.delete("set");
    u.hash = entry ? encodeURIComponent(entryKey(entry)) : "";
    history.replaceState(null, "", u);
  }, [project?.id, chosenRun?.id, activeSet?.id, entry && entryKey(entry)]);
  const perform = async (fn, success) => {
    try {
      await fn();
      setMessage("");
      if (success) toast.success(success);
    } catch (e) {
      setMessage(e.message);
    }
  };
  const list = setEntries
    .filter((e) =>
      `${e.title} ${e.screen} ${e.variant.device} ${e.state}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .filter(
      (e) =>
        filter === "all" ||
        (filter === "open"
          ? e.openNotes > 0
          : !e.captures.current ||
            !e.captures.target ||
            (run.source?.number && !e.captures.pr)),
    );
  const select = (e) => {
    changeView(() => { setSelected(entryKey(e)); setTab("compare"); });
    setMenu(false);
  };
  const index = list.findIndex(
    (e) => entry && entryKey(e) === entryKey(entry),
  );
  async function showPage(value) {
    await changeView(() => { setTab(value); setFocused(false); });
    if (matchMedia("(max-width: 1100px)").matches) {
      document.getElementById("review-panel")?.scrollIntoView({ block: "start" });
    }
  }
  function openCommands() {
    const navigation = [
      ...(run && entry ? ["compare", "feedback", "evidence", "history"] : []).map((page, i) => ({
        id: `page-${page}`, label: page === "compare" ? "Review overview" : page[0].toUpperCase() + page.slice(1), group: "Review",
        shortcut: `Alt+${i + 1}`, run: () => showPage(page),
      })),
      { id: "library", label: (mobile ? menu : !collapsed) ? "Hide library" : "Show library", group: "Workspace", shortcut: "Mod+b", run: () => mobile ? setMenu(!menu) : setCollapsed(!collapsed) },
      { id: "focus", label: focused ? "Show review panel" : "Focus on screenshots", group: "Workspace", run: () => changeView(() => setFocused(!focused)) },
      { id: "refresh", label: "Refresh workspace", group: "Workspace", run: refresh },
      { id: "search", label: "Find a screen", group: "Workspace", shortcut: "/", run: () => { setCollapsed(false); setMenu(true); requestAnimationFrame(() => document.getElementById("search")?.focus()); } },
      ...(projects.data || []).map((project) => ({ id: `project-${project.id}`, label: project.name, group: "Projects", run: () => changeView(() => { setProjectId(project.id); setRunId(""); setSetId(""); setSelected(""); setQuery(""); setFilter("all"); setTab("compare"); }) })),
      ...(reviewSets.data || []).map((set) => ({ id: `set-${set.id}`, label: set.title, group: "Review sets", run: () => chooseSet(set.id) })),
      ...(runs.data || []).map((run) => ({ id: `run-${run.id}`, label: run.title, group: "Review runs", run: () => changeView(() => { setRunId(run.id); setSetId(""); setSelected(""); setQuery(""); setFilter("all"); setTab("compare"); }) })),
      ...(allScreens.data || []).map((screen) => ({
        id: `screen-${screen.id}`, label: screen.title, group: `Screens · ${screen.project}`,
        run: () => perform(async () => {
          const [runs, detail] = await Promise.all([
            api(`/api/runs?project=${encodeURIComponent(screen.project)}`),
            api(`/api/screen?id=${encodeURIComponent(screen.id)}`),
          ]);
          const run = runs.find((r) => detail.captures.some((c) => r.captureIds.includes(c.id)));
          if (!run) throw Error("This screen has no captures in a review run yet.");
          const capture = detail.captures.find((c) => run.captureIds.includes(c.id));
          changeView(() => { setProjectId(screen.project); setRunId(run.id); setSetId(""); setSelected(entryKey(capture)); setQuery(""); setFilter("all"); setTab("compare"); });
        }),
      })),
    ];
    setCommands([...navigation, ...collectActions(showPage)]);
    setCommandOpen(true);
  }
  useEffect(() => {
    if (commandOpen) openCommands();
  }, [allScreens.data, projects.data, runs.data, reviewSets.data, detail.data]);
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || typing(event) || commandOpen || event.repeat || event.target.closest('[role="dialog"], [role="slider"]')) return;
      if (matchesShortcut(event, "Mod+k")) { event.preventDefault(); openCommands(); return; }
      if (matchesShortcut(event, "Mod+b")) { event.preventDefault(); mobile ? setMenu(!menu) : setCollapsed(!collapsed); return; }
      if (matchesShortcut(event, "/")) {
        event.preventDefault(); setCollapsed(false); setMenu(true);
        requestAnimationFrame(() => document.getElementById("search")?.focus()); return;
      }
      for (const [i, page] of ["compare", "feedback", "evidence", "history"].entries()) {
        if (matchesShortcut(event, `Alt+${i + 1}`) && run && entry) { event.preventDefault(); showPage(page); return; }
      }
      const target = [...document.querySelectorAll("[data-shortcut]")].find((element) =>
        !element.disabled && element.checkVisibility() && !element.closest("[inert], [hidden]") && matchesShortcut(event, element.dataset.shortcut));
      if (target) { event.preventDefault(); target.click(); return; }
      if (event.target.closest('button, [role="tab"]') || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (offset && list[index + offset]) { event.preventDefault(); select(list[index + offset]); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const error =
    projects.error || runs.error || comparison.error || detail.error || allScreens.error || reviewSets.error;
  const loading = !error && (!projects.data || project && !runs.data || chosenRun && (!run || !detail.data));
  const skeletonVisible = useDelayedLoading(Boolean(loading), `${project?.id}|${chosenRun?.id}|${entry?.screen}`);
  const feedbackCount = (run?.entries || []).filter((screen) => screen.openNotes > 0).length;
  const approvedCount = (run?.entries || []).filter((screen) => screen.targetApproval).length;
  const setupRequest = "Use Screens to load this project's existing screenshots. Show me which screens still need screenshots.";
  const library = (
        <aside className={cn("screen-library", menu && "library-open")} inert={mobile ? !menu : collapsed} aria-label="Screen library">
          <div className="library-heading"><h2>Library</h2><span id="count">{setEntries.length}</span></div>
          {chosenRun && <div className="run-selection"><NativeSelect className="run-picker" aria-label="Review run" value={chosenRun.id}
            onChange={(event) => { const id = event.target.value; changeView(() => { setRunId(id); setSetId(""); setSelected(""); setQuery(""); setFilter("all"); setTab("compare"); }); }}>
            {runs.data?.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.title}</NativeSelectOption>)}
          </NativeSelect></div>}
          {run && <ReviewSets key={run.id} run={run} sets={reviewSets.data || []} active={activeSet} onSelect={chooseSet} />}
          <div className="library-search"><Search aria-hidden="true" /><Input id="search" aria-label="Find a screen" placeholder="Find a screen" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>/</kbd></div>
          <ToggleGroup className="library-filters" type="single" aria-label="Screen filter" value={filter} onValueChange={(value) => { if (value) setFilter(value); }}>
            {[["all", "All"], ["open", "Feedback"], ["missing", "Missing"]].map(([value, label]) => <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}
          </ToggleGroup>
          <nav id="screens" aria-label="Screens" className="library-list">
            {list.map((item, i) => {
              const preview = item.captures.pr || item.captures.current || item.captures.target;
              return <React.Fragment key={entryKey(item)}>
                {(!activeSet && (i === 0 || list[i - 1].group !== item.group)) && <h3 className="library-group">{item.group}</h3>}
                <a className="screen-item" href={`/?project=${encodeURIComponent(project.id)}&run=${chosenRun.id}${activeSet ? `&set=${encodeURIComponent(activeSet.id)}` : ""}#${encodeURIComponent(entryKey(item))}`} data-review-link
                  title={`${item.title} · ${item.variant.device} · ${item.variant.theme} · ${item.variant.locale} · ${item.variant.viewport}`}
                  aria-current={entryKey(item) === entryKey(entry) ? "page" : undefined}
                  onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); select(item); }}>
                  <span className="library-thumbnail" aria-hidden="true"><CaptureImage capture={preview} alt="" loading="lazy" /></span>
                  <span className="screen-label"><strong>{item.title}</strong><span>{item.variant.device} · {item.variant.theme}{item.state && item.state !== "default" ? ` · ${item.state}` : ""}</span></span>
                  <span className={cn("screen-state", item.openNotes > 0 ? "has-feedback" : item.targetApproval && "is-approved")} title={item.openNotes ? `${item.openNotes} open feedback` : item.targetApproval ? "Design approved" : "Awaiting review"}>
                    {item.openNotes > 0 ? item.openNotes : item.targetApproval ? <Check aria-label="Design approved" /> : <span className="status-dot" aria-label="Awaiting review" />}
                  </span>
                </a>
              </React.Fragment>;
            })}
            {!loading && !list.length && <div className="library-empty"><p>{query ? "No matching screens" : filter !== "all" ? "Nothing in this view" : "Your screens will appear here"}</p>
              {(query || filter !== "all") && <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setFilter("all"); }}>Show all screens</Button>}
            </div>}
          </nav>
          <footer className="library-footer">
            {run && <p>{approvedCount} designs approved<span>{feedbackCount} with feedback</span></p>}
            <div><span><kbd>←</kbd><kbd>→</kbd> Switch screens</span><Button variant="ghost" size="icon" aria-label="Refresh workspace" onClick={refresh}><RefreshCw /></Button></div>
          </footer>
        </aside>
  );
  return (
    <div ref={shell} className={cn("screens-shell", collapsed && "library-collapsed")}>
      <a href="#main" className="skip-link">Skip to comparison</a>
      <header className="workspace-header">
        <div className="workspace-identity">
          <Button id="library-toggle" className="library-toggle" variant="ghost" size="icon" shortcut="Mod+b"
            aria-label={(mobile ? menu : !collapsed) ? "Hide screen library" : "Show screen library"}
            aria-expanded={mobile ? menu : !collapsed}
            onClick={() => mobile ? setMenu(!menu) : setCollapsed(!collapsed)}>
            <span className="icon-swap" data-swapped={mobile ? !menu : collapsed} aria-hidden="true"><PanelLeftClose className="icon-first" /><PanelLeftOpen className="icon-second" /></span>
          </Button>
          <a href="/" data-review-link className="wordmark"><Layers aria-hidden="true" /><span>Screens</span></a>
          {projects.data?.length > 0 && <NativeSelect className="project-picker" aria-label="Project" value={project.id}
            onChange={(event) => { const id = event.target.value; changeView(() => { setProjectId(id); setRunId(""); setSetId(""); setSelected(""); setQuery(""); setFilter("all"); setTab("compare"); }); }}>
            {projects.data.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}
          </NativeSelect>}
        </div>
        <div className="workspace-actions">
          <Button className="command-trigger" variant="secondary" size="sm" aria-label="Search screens and actions" shortcut="Mod+k" onClick={openCommands}>
            <Search /><span>Search</span><kbd>{shortcutLabel("Mod+K")}</kbd>
          </Button>
        </div>
      </header>
      <div className="workspace-body">
        {mobile ? <Drawer direction="left" open={menu} onOpenChange={setMenu}>
          <DrawerContent className="library-drawer" onCloseAutoFocus={(event) => { event.preventDefault(); document.getElementById("library-toggle")?.focus(); }}>
            <DrawerTitle className="sr-only">Screen library</DrawerTitle>
            <DrawerDescription className="sr-only">Find a screen and select a review run.</DrawerDescription>
            <Button className="library-drawer-close" variant="ghost" onClick={() => setMenu(false)}>Close library</Button>
            {library}
          </DrawerContent>
        </Drawer> : library}
        <main id="main" tabIndex={-1} className="review-workspace">
          {error && <Alert className="notice" role="status"><AlertDescription>{error}<Button variant="ghost" size="sm" onClick={refresh}>Try again</Button></AlertDescription></Alert>}
          {message && <Alert className="notice"><AlertDescription>{message}</AlertDescription><Button variant="ghost" size="sm" onClick={() => setMessage("")}>Dismiss</Button></Alert>}
          {projects.data && (!project || runs.data?.length === 0) && <section className="welcome">
            <div className="welcome-symbol" aria-hidden="true"><Images /></div>
            <h1>{project ? `Add screenshots to ${project.name}` : "Add your first screenshots"}</h1>
            <p>Compare your app with its design and comment on what needs to change.</p>
            <div className="welcome-instruction"><p>Open your app's project in your coding assistant and ask:</p><blockquote>{setupRequest}</blockquote>
              <Button onClick={() => perform(() => navigator.clipboard.writeText(setupRequest), "Request copied")}><Copy />Copy request</Button>
            </div>
            <p className="welcome-note">Screens keeps the originals and your feedback on this computer.</p>
            <Collapsible className="welcome-manual"><CollapsibleTrigger>Use an installed command instead</CollapsibleTrigger><CollapsibleContent><code>/screens load /path/to/project</code><p>Use <code>$screens</code> in Codex. Replace the path with your app's folder.</p></CollapsibleContent></Collapsible>
          </section>}
          {loading && <Review loading skeletonVisible={skeletonVisible} tab="compare" setTab={showPage} focused={focused} setFocused={setFocused}
            run={run || { warnings: [] }}
            entry={entry || { title: "Screen title", screen: "loading", variant: { device: "desktop", theme: "light", viewport: "unspecified", locale: "en" }, captures: { current: { id: "loading-current", revision: "loading", variant: { viewport: "720x480" } }, target: { id: "loading-target", revision: "loading", variant: { viewport: "720x480" } } } }}
            detail={{ captures: [], notes: [], targets: [], evidence: [] }} />}
          {run && entry && detail.data && <Review key={`${run.id}|${entryKey(entry)}`}
            {...{ run, entry, detail: detail.data, perform, tab, setTab: showPage, focused, setFocused }}
            position={index + 1} total={list.length}
            previous={index > 0 ? () => select(list[index - 1]) : null}
            next={index >= 0 && index < list.length - 1 ? () => select(list[index + 1]) : null} />}
        </main>
      </div>
      <CommandMenu open={commandOpen} commands={commands} mobile={mobile} onClose={() => setCommandOpen(false)} />
    </div>
  );
}
