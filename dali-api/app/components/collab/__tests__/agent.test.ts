import { describe, expect, it } from "vitest";
import {
  AGENT_COLORS,
  agentClientId,
  agentDisplayName,
  agentKindFromClientName,
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
