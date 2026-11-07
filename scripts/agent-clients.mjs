export const agentClients = {
  generic: { name: "Any Agent Skills client", folder: ".agents" },
  claude: { name: "Claude Code", folder: ".claude" },
  codex: { name: "Codex", folder: ".agents" },
  cursor: { name: "Cursor", folder: ".agents" },
  copilot: { name: "GitHub Copilot", folder: ".github" },
  gemini: { name: "Gemini CLI", folder: ".agents" },
  opencode: { name: "OpenCode", folder: ".agents" },
};

export function selectClients(selection = "all") {
  const clients = selection === "all"
    ? Object.keys(agentClients)
    : selection === "both" ? ["claude", "codex"] : selection.split(",");
  for (const client of clients) {
    if (!agentClients[client])
      throw Error(`Unknown client ${client}. Use all, both, or ${Object.keys(agentClients).join(", ")}.`);
  }
  return [...new Set(clients)];
}
