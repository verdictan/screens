import { requireThat } from "./validation.mjs";
import { createDiff } from "./diff.mjs";
const string = { type: "string" };
const object = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const json = (value) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

export function mcpTools(store) {
  const tools = [
    [
      "diffs_create",
      "Measure pixel changes between exact captures. Masks are integer pixel rectangles; scores do not decide acceptance.",
      object(
        {
          left: string,
          right: string,
          threshold: { type: "integer", minimum: 0, maximum: 255 },
          masks: {
            type: "array",
            items: object(
              {
                x: { type: "integer" },
                y: { type: "integer" },
                width: { type: "integer" },
                height: { type: "integer" },
              },
              ["x", "y", "width", "height"],
            ),
          },
        },
        ["left", "right"],
      ),
      (a) => createDiff(store, a),
    ],
    [
      "diffs_view",
      "Read persisted diff measurements and the lossless artifact, when available.",
      object({ id: string }, ["id"]),
      (a) => {
        const value = store.getDiff(a.id),
          content = [{ type: "text", text: JSON.stringify(value) }];
        if (value.image) {
          const bytes = store.diffImage(a.id);
          requireThat(
            bytes.length <= 10 * 1024 * 1024,
            "Diff exceeds MCP limit; view in picker",
          );
          content.push({
            type: "image",
            mimeType: "image/png",
            data: bytes.toString("base64"),
          });
        }
        return { content };
      },
    ],
    [
      "evidence_add",
      "Attach a reporter-supplied check to an exact capture; does not approve or verify a fix. Automated pass/fail requires a report artifact.",
      object(
        {
          capture: string,
          kind: { enum: ["visual", "behavior", "accessibility", "motion"] },
          method: { enum: ["manual", "automated", "screenshot"] },
          outcome: { enum: ["pass", "fail", "not-run"] },
          assertion: string,
          observation: string,
          procedure: string,
          author: string,
          artifactBase64: string,
          artifactType: {
            enum: ["text/plain", "application/json", "video/mp4", "video/webm"],
          },
        },
        [
          "capture",
          "kind",
          "method",
          "outcome",
          "assertion",
          "observation",
          "procedure",
          "author",
        ],
      ),
      (a) => store.addEvidence(a),
    ],
    [
      "evidence_list",
      "List immutable reported checks for a capture or screen. Read artifact URLs in the local picker; these are reported results, not acceptance decisions.",
      object({ capture: string, screen: string }),
      (a) => store.listEvidence(a),
    ],
    [
      "projects_list",
      "List registered projects.",
      object({}),
      () => store.projects(),
    ],
    [
      "screens_search",
      "Find screens. Images are retrieved separately with captures_view.",
      object({ project: string, query: string }),
      (a) => store.search(a),
    ],
    [
      "screens_get",
      "Get screen requirements, capture history, approved targets and capture-bound feedback.",
      object({ id: string }, ["id"]),
      (a) => store.getScreen(a.id),
    ],
    [
      "screens_register",
      "Register a screen with a stable key. Existing identities are retained.",
      object(
        {
          project: string,
          key: string,
          title: string,
          state: string,
          group: string,
          route: string,
          source: string,
          recipe: string,
        },
        ["project", "key", "title"],
      ),
      (a) => store.screen(a),
    ],
    [
      "captures_register",
      "Store an immutable PNG/JPEG/WebP capture. Supply source revision and fixture; do not claim unknown provenance.",
      object(
        {
          screen: string,
          role: { enum: ["current", "target", "pr"] },
          imageBase64: string,
          revision: string,
          fixture: string,
          provenance: string,
          variant: object({
            device: string,
            theme: string,
            viewport: string,
            locale: string,
            textScale: string,
          }),
        },
        ["screen", "role", "imageBase64", "revision", "fixture", "provenance"],
      ),
      (a) => store.capture(a),
    ],
    [
      "captures_view",
      "Return capture metadata and actual image content for visual inspection.",
      object({ id: string }, ["id"]),
      (a) => {
        const { capture, bytes } = store.image(a.id);
        requireThat(
          bytes.length <= 10 * 1024 * 1024,
          "Image exceeds 10 MB MCP limit; inspect via the review UI or use a smaller capture",
        );
        return {
          content: [
            { type: "text", text: JSON.stringify(capture) },
            {
              type: "image",
              mimeType: capture.mimeType,
              data: bytes.toString("base64"),
            },
          ],
        };
      },
    ],
    [
      "runs_list",
      "List immutable review runs for a project.",
      object({ project: string }, ["project"]),
      (a) => store.runs(a.project),
    ],
    [
      "runs_compare",
      "Get aligned Current / Target / PR capture IDs and evidence gaps for a run. No visual match is inferred.",
      object({ id: string }, ["id"]),
      (a) => store.compare(a.id),
    ],
    [
      "reviews_add_note",
      "Add feedback tied to an immutable capture, optionally at normalized image coordinates.",
      object(
        {
          capture: string,
          text: string,
          author: string,
          point: object(
            {
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
            },
            ["x", "y"],
          ),
        },
        ["capture", "text"],
      ),
      (a) => store.addNote(a),
    ],
    [
      "reviews_submit_fix",
      "Submit fresh implementation evidence and a resolution. Cannot approve or verify.",
      object(
        {
          id: string,
          expectedRevision: { type: "integer" },
          evidence: string,
          resolution: string,
        },
        ["id", "expectedRevision", "evidence", "resolution"],
      ),
      (a) => store.updateNote({ ...a, status: "submitted" }),
    ],
  ];
  return tools.map(([name, description, inputSchema, call]) => ({
    name,
    description,
    inputSchema,
    call,
  }));
}

export function protocol(store) {
  const tools = mcpTools(store);
  return async function handle(message) {
    if (Array.isArray(message)) {
      if (!message.length)
        return {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Empty batch" },
        };
      const replies = (await Promise.all(message.map(handle))).filter(Boolean);
      return replies.length ? replies : null;
    }
    if (
      !message ||
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string"
    )
      return {
        jsonrpc: "2.0",
        id: message?.id ?? null,
        error: { code: -32600, message: "Invalid request" },
      };
    if (message.id === undefined) return null;
    const reply = { jsonrpc: "2.0", id: message.id };
    if (message.method === "initialize")
      return {
        ...reply,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "verdictan-screens", version: "0.3.0" },
          instructions:
            "Use screens_search, then screens_get and captures_view. Submit evidence; human review decides acceptance. Imported targets are not automatically approved.",
        },
      };
    if (message.method === "ping") return { ...reply, result: {} };
    if (message.method === "tools/list")
      return {
        ...reply,
        result: { tools: tools.map(({ call, ...tool }) => tool) },
      };
    if (message.method === "tools/call") {
      const tool = tools.find((t) => t.name === message.params?.name);
      if (!tool)
        return { ...reply, error: { code: -32602, message: "Unknown tool" } };
      const args = message.params.arguments ?? {};
      if (
        !args ||
        typeof args !== "object" ||
        Array.isArray(args) ||
        tool.inputSchema.required.some((k) => args[k] === undefined) ||
        Object.keys(args).some((k) => !(k in tool.inputSchema.properties))
      )
        return {
          ...reply,
          error: { code: -32602, message: "Invalid tool arguments" },
        };
      try {
        const result = await tool.call(args);
        return { ...reply, result: result?.content ? result : json(result) };
      } catch (e) {
        return {
          ...reply,
          result: {
            isError: true,
            content: [{ type: "text", text: e.message }],
          },
        };
      }
    }
    return { ...reply, error: { code: -32601, message: "Method not found" } };
  };
}
