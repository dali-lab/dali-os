export type AgentKind = "claude" | "chatgpt" | "cursor" | "other";
export type AgentAction = "reading" | "editing";

/** Awareness `user.agent`: present only on entries an MCP agent caused. */
export interface AwarenessAgent {
  kind: AgentKind;
  action: AgentAction;
}

// 6-digit hex: y-prosemirror appends an alpha suffix for the selection tint.
export const AGENT_COLORS: Record<AgentKind, string> = {
  claude: "#d97757",
  chatgpt: "#10a37f",
  cursor: "#52525b",
  other: "#6366f1",
};

const KIND_PATTERNS: [AgentKind, RegExp][] = [
  ["claude", /claude|anthropic/i],
  ["chatgpt", /chatgpt|openai/i],
  ["cursor", /cursor/i],
];

/** The MCP client name is self-reported at registration, so match loosely. */
export function agentKindFromClientName(clientName: string): AgentKind {
  return KIND_PATTERNS.find(([, re]) => re.test(clientName))?.[0] ?? "other";
}

const KIND_NAMES: Record<Exclude<AgentKind, "other">, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  cursor: "Cursor",
};

export function agentDisplayName(kind: AgentKind, clientName: string): string {
  if (kind !== "other") return KIND_NAMES[kind];
  const trimmed = clientName.trim().slice(0, 40);
  return trimmed || "Agent";
}

/** Stable nonzero uint32 per (owner, agent kind), shared by every machine. */
export function agentClientId(userId: string, kind: AgentKind): number {
  let h = 0x811c9dc5;
  for (const ch of `agent|${userId}|${kind}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 1;
}
