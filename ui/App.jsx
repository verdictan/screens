import React, { useEffect, useState } from "react";
import {
  Layers,
  Search,
  Menu,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Check,
  MessageSquare,
  Images,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api, useResource, entryKey } from "@/lib/api";
import { Comparison } from "./Comparison";
import { Feedback, Evidence, History } from "./ReviewPanels";
import { cn } from "@/lib/utils";
export function Field({ label, children, className }) {
  return (
    <label
      className={cn(
        "flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {label}
      {children}
    </label>
  );
}
export function Notice({ children }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-warning/25 bg-warning-surface px-4 py-3 text-sm text-warning"
    >
      {children}
    </div>
  );
}
export function App() {
  const params = new URLSearchParams(location.search);
  const [projectId, setProjectId] = useState(params.get("project") || "");
  const [runId, setRunId] = useState(params.get("run") || "");
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
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState("");
  const projects = useResource("/api/projects");
  const project =
    projects.data?.find((p) => p.id === projectId) || projects.data?.[0];
  const runs = useResource(
    project ? `/api/runs?project=${encodeURIComponent(project.id)}` : null,
    revision,
  );
  const chosenRun = runs.data?.find((r) => r.id === runId) || runs.data?.[0];
  const comparison = useResource(
    chosenRun ? `/api/compare?run=${chosenRun.id}` : null,
    revision,
  );
  const run = comparison.data;
  const entry =
    run?.entries.find((e) => entryKey(e) === selected) || run?.entries[0];
  const detail = useResource(
    entry ? `/api/screen?id=${encodeURIComponent(entry.screen)}` : null,
    revision,
  );
  const refresh = () => setRevision((r) => r + 1);
  useEffect(() => {
    if (!project) return;
    const u = new URL(location.href);
    u.searchParams.set("project", project.id);
    chosenRun
      ? u.searchParams.set("run", chosenRun.id)
      : u.searchParams.delete("run");
    u.hash = entry ? encodeURIComponent(entryKey(entry)) : "";
    history.replaceState(null, "", u);
  }, [project?.id, chosenRun?.id, entry && entryKey(entry)]);
  const perform = async (fn) => {
    try {
      await fn();
    } catch (e) {
      setMessage(e.message);
    }
  };
  const list = (run?.entries || [])
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
    setSelected(entryKey(e));
    setMenu(false);
  };
  const index = list.findIndex(
    (e) => entryKey(e) === entryKey(entry || { variant: {} }),
  );
  useEffect(() => {
    const onKey = (event) => {
      if (event.target.closest('input,textarea,select,button,[role="tab"]'))
        return;
      const offset =
        event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (offset && list[index + offset]) {
        event.preventDefault();
        select(list[index + offset]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [list, index]);
  const error =
    projects.error || runs.error || comparison.error || detail.error;
  return (
    <div className={cn("screens-shell", collapsed && "library-collapsed")}>
      <a
        href="#main"
        className="sr-only z-50 rounded bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to comparison
      </a>
      <header className="workspace-header">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="mobile-menu"
            aria-label="Toggle screen library"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </Button>
          <a
            href="/"
            className="flex items-center gap-2.5 font-semibold tracking-tight"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Layers className="size-4" />
            </span>
            <span className="text-base">screens</span>
          </a>
          <span className="mx-1 text-border">/</span>
          <span className="truncate text-sm text-muted-foreground">
            {project?.name || "Workspace"}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-4">
          {chosenRun && (
            <NativeSelect
              className="run-picker"
              aria-label="Review run"
              value={chosenRun.id}
              onChange={(e) => {
                setRunId(e.target.value);
                setSelected("");
              }}
            >
              {runs.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </NativeSelect>
          )}
          <span className="registry-indicator">
            <span className="size-1.5 rounded-full bg-success-indicator" />
            Local
          </span>
        </div>
      </header>
      <div className="workspace-body">
        <aside className={cn("screen-library", menu && "library-open")}>
          <div className="space-y-4 p-4">
            <Field label="Project">
              <NativeSelect
                aria-label="Project"
                value={project?.id || ""}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setRunId("");
                  setSelected("");
                }}
              >
                {!projects.data?.length && (
                  <option value="">No projects</option>
                )}
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium text-muted-foreground">
                Screens
              </h2>
              <span
                className="font-mono text-[11px] text-muted-foreground"
                id="count"
              >
                {list.length}
              </span>
            </div>
            <div className="relative">
              <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                id="search"
                aria-label="Find a screen"
                placeholder="Find a screen…"
                className="bg-background pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <NativeSelect
              aria-label="Screen filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All screens</option>
              <option value="open">With open feedback</option>
              <option value="missing">Missing evidence</option>
            </NativeSelect>
          </div>
          <nav
            id="screens"
            aria-label="Screens"
            className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4"
          >
            {list.map((e, i) => (
              <React.Fragment key={entryKey(e)}>
                {(i === 0 || list[i - 1].group !== e.group) && (
                  <h3 className="px-3 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {e.group}
                  </h3>
                )}
                <button
                  onClick={() => select(e)}
                  aria-current={
                    entry && entryKey(e) === entryKey(entry)
                      ? "page"
                      : undefined
                  }
                  title={e.title}
                  className="screen-item"
                >
                  <span className="screen-key">
                    {e.state || String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-xs font-medium leading-5">
                      {e.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {e.variant.device} · {e.state}
                    </span>
                  </span>
                  {e.openNotes > 0 && (
                    <Badge variant="outline">{e.openNotes}</Badge>
                  )}
                </button>
              </React.Fragment>
            ))}
            {!list.length && (
              <p className="px-3 py-5 text-xs text-muted-foreground">
                {query
                  ? "No screens match this search."
                  : "Load a project to start reviewing."}
              </p>
            )}
          </nav>
          <div className="border-t px-4 py-3 text-[11px] text-muted-foreground">
            ← → &nbsp; Move between screens
          </div>
        </aside>
        <main id="main" tabIndex={-1} className="review-workspace">
          <Button
            className="library-toggle"
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={
              collapsed ? "Show screen library" : "Hide screen library"
            }
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            <span>{collapsed ? "Show library" : "Hide library"}</span>
          </Button>
          {error && <Notice>{error}</Notice>}
          {message && (
            <div
              className="mb-4 flex items-center gap-3 rounded-lg border bg-muted p-3 text-sm"
              role="status"
            >
              <span className="flex-1">{message}</span>
              <Button variant="ghost" size="sm" onClick={() => setMessage("")}>
                Dismiss
              </Button>
            </div>
          )}
          {!projects.data && !error && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Connecting to registry…
            </p>
          )}
          {projects.data && (!project || runs.data?.length === 0) && (
            <div className="mx-auto max-w-2xl py-20">
              <Badge variant="outline">YOUR SCREEN WORKSPACE</Badge>
              <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight">
                Every screen.
                <br />A clear point of comparison.
              </h1>
              <p className="mt-5 max-w-lg text-muted-foreground">
                Bring design targets, implementation captures, and feedback into
                one shared review.
              </p>
              <Card className="mt-8">
                <CardHeader>
                  <CardTitle>Load your first project</CardTitle>
                  <CardDescription>
                    Ask your agent to load an existing screen manifest.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <code className="block overflow-x-auto rounded bg-muted p-4 text-sm">
                    /screens load /path/to/project
                  </code>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Claude Code: /screens · Codex: $screens
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
          {chosenRun && (!run || !detail.data) && !error && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading screen evidence…
            </p>
          )}
          {run && entry && detail.data && (
            <Review
              key={`${run.id}|${entryKey(entry)}`}
              {...{ run, entry, detail: detail.data, refresh, perform }}
              previous={index > 0 ? () => select(list[index - 1]) : null}
              next={
                index >= 0 && index < list.length - 1
                  ? () => select(list[index + 1])
                  : null
              }
            />
          )}
        </main>
      </div>
    </div>
  );
}
function Review({ run, entry, detail, refresh, perform, previous, next }) {
  const [tab, setTab] = useState("compare");
  const sameIds = new Set(
    detail.captures
      .filter(
        (c) => JSON.stringify(c.variant) === JSON.stringify(entry.variant),
      )
      .map((c) => c.id),
  );
  const notes = detail.notes.filter((n) => sameIds.has(n.capture));
  const exactIds = new Set(Object.values(entry.captures).map((c) => c.id));
  const evidence = detail.evidence.filter((e) => exactIds.has(e.capture));
  const [pin, setPin] = useState(null);
  const warnings = [
    ...(run.warnings || []),
    ...(run.uncoveredScreens?.length
      ? [
          `${run.uncoveredScreens.length} registered screens have no captures in this run: ${run.uncoveredScreens.map((s) => s.title).join(", ")}`,
        ]
      : []),
  ];
  return (
    <div id="review" className="space-y-4">
      <div className="review-heading">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{entry.group || "Screens"}</span>
            <span>/</span>
            <span className="font-mono">
              {entry.state || entry.screen.split("/").pop()}
            </span>
          </div>
          <h1
            id="title"
            title={entry.title}
            className="line-clamp-2 text-lg font-semibold leading-6 tracking-tight"
          >
            {entry.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="capitalize">{entry.variant.device}</span>
            <span>·</span>
            <span>{entry.variant.theme}</span>
            {entry.variant.viewport !== "unspecified" && (
              <>
                <span>·</span>
                <span>{entry.variant.viewport}</span>
              </>
            )}
            <span>·</span>
            <span>{entry.variant.locale}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            id="previous"
            aria-label="Previous screen"
            variant="ghost"
            size="icon"
            disabled={!previous}
            onClick={previous}
          >
            <ChevronLeft />
          </Button>
          <Button
            id="next"
            aria-label="Next screen"
            variant="ghost"
            size="icon"
            disabled={!next}
            onClick={next}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="review-tabbar">
          <TabsList aria-label="Review sections">
            <TabsTrigger value="compare">Compare</TabsTrigger>
            <TabsTrigger value="feedback">
              Feedback{" "}
              <span className="text-xs text-muted-foreground">
                {notes.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="evidence">
              Evidence{" "}
              <span className="text-xs text-muted-foreground">
                {evidence.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <Badge variant={entry.targetApproval ? "success" : "outline"}>
            {entry.targetApproval ? "Target approved" : "Awaiting review"}
          </Badge>
        </div>
        <TabsContent value="compare">
          <Comparison
            {...{ entry, detail, perform, refresh }}
            onPin={(value) => {
              setPin(value);
              setTab("feedback");
            }}
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <p>Review the exact captures. A pixel score is not acceptance.</p>
            {entry.captures.target && !entry.targetApproval && (
              <Button
                id="approve"
                variant="outline"
                size="sm"
                onClick={() =>
                  perform(async () => {
                    const c = entry.captures.target;
                    const prior = detail.targets.find((t) =>
                      detail.captures.some(
                        (x) =>
                          x.id === t.capture &&
                          JSON.stringify(x.variant) ===
                            JSON.stringify(c.variant),
                      ),
                    );
                    await api("/api/targets/approve", {
                      capture: c.id,
                      expectedRevision: prior?.revision ?? 0,
                    });
                    refresh();
                  })
                }
              >
                <Check />
                Approve this target
              </Button>
            )}
          </div>
        </TabsContent>
        <TabsContent value="feedback">
          <Feedback
            {...{ entry, detail, notes, pin, setPin, refresh, perform }}
          />
        </TabsContent>
        <TabsContent value="evidence">
          <Evidence {...{ entry, evidence, refresh, perform }} />
        </TabsContent>
        <TabsContent value="history">
          <History detail={detail} />
        </TabsContent>
      </Tabs>
      {warnings.length > 0 && (
        <details className="evidence-notice">
          <summary>
            Evidence gaps · {warnings.length}{" "}
            {warnings.length === 1 ? "notice" : "notices"}
          </summary>
          <div className="mt-3 space-y-2">
            {warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
