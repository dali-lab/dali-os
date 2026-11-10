import { describe, expect, it } from "vitest";
import {
  AGENT_COLORS,
  AGENT_SESSION_COLORS,
  AGENT_TOUCH_EXPIRE_MS,
  AgentTouchTracker,
  agentBatchesFromStates,
  agentClientId,
  agentDisplayName,
  agentKindFromClientName,
  agentSessionColor,
  agentSessionLabel,
  isAgentState,
} from "../agent";

describe("agentKindFromClientName", () => {
  it.each([
    ["Claude", "claude"],
    ["claude-code", "claude"],
    ["Claude Desktop", "claude"],
    ["Anthropic MCP client", "claude"],
    ["ChatGPT", "chatgpt"],
    ["OpenAI Connector", "chatgpt"],
    ["Cursor", "cursor"],
    ["cursor-vscode", "cursor"],
    ["MCP Inspector", "other"],
    ["", "other"],
  ] as const)("%s → %s", (name, kind) => {
    expect(agentKindFromClientName(name)).toBe(kind);
  });
});

describe("agentDisplayName", () => {
  it("uses the product name for known agents regardless of the registered name", () => {
    expect(agentDisplayName("claude", "claude-code")).toBe("Claude");
    expect(agentDisplayName("chatgpt", "OpenAI Connector")).toBe("ChatGPT");
    expect(agentDisplayName("cursor", "cursor-vscode")).toBe("Cursor");
  });

  it("falls back to the trimmed client name, capped at 40 chars", () => {
    expect(agentDisplayName("other", "  MCP Inspector ")).toBe("MCP Inspector");
    expect(agentDisplayName("other", "x".repeat(60))).toBe("x".repeat(40));
  });

  it("calls a nameless client Agent", () => {
    expect(agentDisplayName("other", "   ")).toBe("Agent");
  });
});

describe("agentClientId", () => {
  it("is stable for the same owner and kind, so every machine injects one entry", () => {
    expect(agentClientId("u1", "claude")).toBe(agentClientId("u1", "claude"));
  });

  it("differs across owners and across kinds", () => {
    const ids = new Set([
      agentClientId("u1", "claude"),
      agentClientId("u2", "claude"),
      agentClientId("u1", "cursor"),
    ]);
    expect(ids.size).toBe(3);
  });

  it("keeps the two-argument id when there is no session", () => {
    expect(agentClientId("u1", "claude", undefined)).toBe(agentClientId("u1", "claude"));
  });

  it("separates sessions, and a session's variants", () => {
    const ids = new Set([
      agentClientId("u1", "claude"),
      agentClientId("u1", "claude", "g1"),
      agentClientId("u1", "claude", "g2"),
      agentClientId("u1", "claude", "g1", "1|#2563eb"),
      agentClientId("u1", "claude", "g1", "1|#9333ea"),
    ]);
    expect(ids.size).toBe(5);
    expect(agentClientId("u1", "claude", "g1")).toBe(agentClientId("u1", "claude", "g1"));
  });

  it("is a nonzero uint32", () => {
    for (const user of ["u1", "u2", "", "cl0000000000000000000000"]) {
      const id = agentClientId(user, "other");
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("AGENT_COLORS", () => {
  it("are 6-digit hex, which y-prosemirror needs to append an alpha suffix", () => {
    for (const color of Object.values(AGENT_COLORS)) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("agentSessionLabel", () => {
  it("leaves the first session unnumbered and counts from 2", () => {
    expect(agentSessionLabel("Claude", 0)).toBe("Claude");
    expect(agentSessionLabel("Claude", 1)).toBe("Claude 2");
    expect(agentSessionLabel("Claude", 2)).toBe("Claude 3");
  });
});

describe("agentSessionColor", () => {
  it("gives the first session the agent's own colour", () => {
    expect(agentSessionColor("claude", 0, "u1|g1")).toBe(AGENT_COLORS.claude);
  });

  it("gives later sessions a palette colour that depends only on the key", () => {
    const color = agentSessionColor("claude", 1, "u1|g2");
    expect(AGENT_SESSION_COLORS).toContain(color);
    expect(agentSessionColor("claude", 1, "u1|g2")).toBe(color);
  });

  it("skips colours already taken", () => {
    const first = agentSessionColor("claude", 1, "u1|g2");
    const second = agentSessionColor("claude", 2, "u1|g2", [AGENT_COLORS.claude, first]);
    expect(second).not.toBe(first);
    expect(AGENT_SESSION_COLORS).toContain(second);
  });

  it("never reuses an agent kind's colour, and stays 6-digit hex", () => {
    for (const color of AGENT_SESSION_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      expect(Object.values(AGENT_COLORS)).not.toContain(color);
    }
    expect(new Set(AGENT_SESSION_COLORS).size).toBe(AGENT_SESSION_COLORS.length);
  });

  it("falls back to a palette colour once every one is taken", () => {
    expect(AGENT_SESSION_COLORS).toContain(agentSessionColor("claude", 9, "u1|g9", AGENT_SESSION_COLORS));
  });
});

const agentState = (extra: Record<string, unknown> = {}) => ({
  user: { name: "Claude", color: "#d97757", agent: { kind: "claude", action: "editing" } },
  ...extra,
});

describe("isAgentState", () => {
  it("is true only for states with a user.agent object", () => {
    expect(isAgentState(agentState())).toBe(true);
    expect(isAgentState({ user: { name: "Ada" } })).toBe(false);
    expect(isAgentState({ user: { name: "Ada", agent: true } })).toBe(false);
    expect(isAgentState(null)).toBe(false);
    expect(isAgentState({})).toBe(false);
  });
});

describe("agentBatchesFromStates", () => {
  it("reads well-formed agent batches and skips everything else", () => {
    const states: [number, unknown][] = [
      [1, agentState({ touched: { ids: ["a", "b"], seq: 3 } })],
      [2, { user: { name: "Ada", color: "#000000" }, touched: { ids: ["x"], seq: 1 } }],
      [3, agentState({ touched: { ids: "a", seq: 1 } })],
      [4, agentState({ touched: { ids: ["a"], seq: Number.NaN } })],
      [5, agentState({ touched: { ids: [7, "", "c"], seq: 1 } })],
      [6, agentState({ touched: { ids: [], seq: 1 } })],
      [7, agentState()],
      [8, agentState({ touched: { ids: ["mine"], seq: 1 } })],
    ];
    expect(agentBatchesFromStates(states, 8)).toEqual([
      { clientId: 1, seq: 3, ids: ["a", "b"], name: "Claude", color: "#d97757" },
      { clientId: 5, seq: 1, ids: ["c"], name: "Claude", color: "#d97757" },
    ]);
  });

  it("keeps the last 40 ids and greys out a colour that isn't 6-digit hex", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `b${i}`);
    const [batch] = agentBatchesFromStates(
      [[1, { user: { name: "Claude", color: "red", agent: { kind: "claude", action: "editing" } }, touched: { ids, seq: 1 } }]],
      0,
    );
    expect(batch!.ids).toEqual(ids.slice(10));
    expect(batch!.color).toBe(AGENT_COLORS.other);
  });
});

describe("AgentTouchTracker", () => {
  const touched = (ids: string[], seq: number, extra: Record<string, unknown> = {}) =>
    agentState({ touched: { ids, seq }, ...extra });

  it("shows a batch from when this editor first sees it until it expires", () => {
    let now = 1_000;
    const tracker = new AgentTouchTracker(() => now);
    expect(tracker.update([[1, touched(["a"], 1)]], 0)).toBe(true);
    expect(tracker.touches().map((t) => t.id)).toEqual(["a"]);
    expect(tracker.nextExpiryIn()).toBe(AGENT_TOUCH_EXPIRE_MS);

    now += AGENT_TOUCH_EXPIRE_MS - 1;
    expect(tracker.sweep()).toBe(false);
    now += 1;
    expect(tracker.sweep()).toBe(true);
    expect(tracker.touches()).toEqual([]);
    expect(tracker.nextExpiryIn()).toBeNull();
  });

  it("doesn't restart a batch when the same state is sent again", () => {
    let now = 0;
    const tracker = new AgentTouchTracker(() => now);
    tracker.update([[1, touched(["a"], 1)]], 0);
    now = 3_000;
    expect(tracker.update([[1, touched(["a"], 1, { cursor: null })]], 0)).toBe(false);
    expect(tracker.touches()[0]!.at).toBe(0);
  });

  it("gives a block to the batch that touched it last, numbering batches", () => {
    let now = 0;
    const tracker = new AgentTouchTracker(() => now);
    tracker.update([[1, touched(["a", "b"], 1)]], 0);
    now = 1_000;
    tracker.update([[1, touched(["b"], 2)]], 0);
    expect(tracker.touches().map((t) => [t.id, t.batch, t.at])).toEqual([
      ["a", 1, 0],
      ["b", 2, 1_000],
    ]);
  });

  it("forgets a client that left, so its next batch shows even with an old seq", () => {
    const tracker = new AgentTouchTracker(() => 0, 10);
    tracker.update([[1, touched(["a"], 1)]], 0);
    tracker.update([], 0);
    expect(tracker.update([[1, touched(["a"], 1)]], 0)).toBe(true);
  });

  it("ignores the local client and people", () => {
    const tracker = new AgentTouchTracker(() => 0);
    expect(tracker.update([[1, touched(["a"], 1)]], 1)).toBe(false);
    expect(tracker.update([[2, { user: { name: "Ada" }, touched: { ids: ["a"], seq: 1 } }]], 1)).toBe(false);
    expect(tracker.touches()).toEqual([]);
  });
});
