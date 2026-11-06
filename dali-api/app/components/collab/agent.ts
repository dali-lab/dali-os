export type AgentKind = "claude" | "chatgpt" | "cursor" | "other";
export type AgentAction = "reading" | "editing" | "pointing";

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

export const AGENT_SESSION_COLORS: readonly string[] = [
  "#2563eb",
  "#9333ea",
  "#db2777",
  "#0891b2",
  "#ca8a04",
  "#65a30d",
  "#0d9488",
  "#a21caf",
];

export const AGENT_TOUCHED_MAX = 40;
export const AGENT_TOUCH_FADE_MS = 5_000;
export const AGENT_TOUCH_EXPIRE_MS = 5_500;

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

function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (const ch of input) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Stable nonzero uint32 per (owner, agent kind[, session, variant]), shared by every machine. */
export function agentClientId(
  userId: string,
  kind: AgentKind,
  session?: string,
  variant?: string,
): number {
  const key =
    session === undefined && variant === undefined
      ? `agent|${userId}|${kind}`
      : `agent|${userId}|${kind}|${session ?? "-"}|${variant ?? ""}`;
  return fnv1a(key) || 1;
}

/** "Claude" for a person's first session in a room, then "Claude 2", "Claude 3". */
export function agentSessionLabel(name: string, index: number): string {
  return index <= 0 ? name : `${name} ${index + 1}`;
}

/**
 * The first session wears the kind's colour; later ones pick from the session
 * palette by their key, skipping colours already taken.
 */
export function agentSessionColor(
  kind: AgentKind,
  index: number,
  key: string,
  taken: Iterable<string> = [],
): string {
  if (index <= 0) return AGENT_COLORS[kind];
  const avoid = new Set([AGENT_COLORS[kind], ...taken].map((c) => c.toLowerCase()));
  const start = fnv1a(`agent-color|${key}`) % AGENT_SESSION_COLORS.length;
  for (let i = 0; i < AGENT_SESSION_COLORS.length; i++) {
    const color = AGENT_SESSION_COLORS[(start + i) % AGENT_SESSION_COLORS.length]!;
    if (!avoid.has(color)) return color;
  }
  return AGENT_SESSION_COLORS[start]!;
}

export interface AgentTouched {
  ids: string[];
  seq: number;
}

export interface AgentBatch {
  clientId: number;
  seq: number;
  ids: string[];
  name: string;
  color: string;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FALLBACK_COLOR = AGENT_COLORS.other;

export function agentKindOf(kind: unknown): AgentKind {
  return typeof kind === "string" && Object.hasOwn(AGENT_COLORS, kind) ? (kind as AgentKind) : "other";
}

export function isAgentState(state: unknown): boolean {
  const user = (state as { user?: { agent?: unknown } } | null | undefined)?.user;
  return !!user && typeof user.agent === "object" && user.agent !== null;
}

/** Well-formed `touched` batches from agent awareness states, never the local client's. */
export function agentBatchesFromStates(
  states: Iterable<[number, unknown]>,
  localClientId: number,
): AgentBatch[] {
  const out: AgentBatch[] = [];
  for (const [clientId, raw] of states) {
    if (clientId === localClientId || !isAgentState(raw)) continue;
    const state = raw as { user: { name?: unknown; color?: unknown }; touched?: unknown };
    const touched = state.touched as { ids?: unknown; seq?: unknown } | undefined;
    if (!touched || !Array.isArray(touched.ids) || typeof touched.seq !== "number") continue;
    if (!Number.isFinite(touched.seq)) continue;
    const ids = touched.ids
      .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200)
      .slice(-AGENT_TOUCHED_MAX);
    if (ids.length === 0) continue;
    const { name, color } = state.user;
    out.push({
      clientId,
      seq: touched.seq,
      ids,
      name: typeof name === "string" ? name.slice(0, 200) : "",
      color: typeof color === "string" && HEX_COLOR.test(color) ? color : FALLBACK_COLOR,
    });
  }
  return out;
}

export interface AgentTouch {
  id: string;
  clientId: number;
  seq: number;
  name: string;
  color: string;
  at: number;
  batch: number;
}

/**
 * Which blocks show an agent's touch. A batch counts from when this editor
 * first sees its (clientId, seq), so a renewed state never restarts it.
 */
export class AgentTouchTracker {
  private readonly seen = new Map<number, number>();
  private readonly byId = new Map<string, AgentTouch>();
  private batches = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly expireMs: number = AGENT_TOUCH_EXPIRE_MS,
  ) {}

  update(states: Iterable<[number, unknown]>, localClientId: number): boolean {
    let changed = this.sweep();
    const at = this.now();
    const list = [...states];
    const present = new Set(list.map(([id]) => id));
    for (const id of this.seen.keys()) if (!present.has(id)) this.seen.delete(id);
    for (const batch of agentBatchesFromStates(list, localClientId)) {
      if (this.seen.get(batch.clientId) === batch.seq) continue;
      this.seen.set(batch.clientId, batch.seq);
      const number = ++this.batches;
      for (const id of batch.ids) {
        this.byId.set(id, { id, clientId: batch.clientId, seq: batch.seq, name: batch.name, color: batch.color, at, batch: number });
      }
      changed = true;
    }
    return changed;
  }

  sweep(): boolean {
    const now = this.now();
    let changed = false;
    for (const [id, touch] of this.byId) {
      if (now - touch.at >= this.expireMs) {
        this.byId.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  touches(): AgentTouch[] {
    return [...this.byId.values()].sort((a, b) => a.batch - b.batch);
  }

  nextExpiryIn(): number | null {
    let next: number | null = null;
    const now = this.now();
    for (const touch of this.byId.values()) {
      const left = Math.max(0, touch.at + this.expireMs - now);
      if (next === null || left < next) next = left;
    }
    return next;
  }
}
