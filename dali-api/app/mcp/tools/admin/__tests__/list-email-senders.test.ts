import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/gmail-integration", () => ({
  listSenderIntegrations: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  isCore: vi.fn(),
}));

import { listSenderIntegrations } from "~/lib/gmail-integration";
import { isCore } from "~/lib/roles";
import {
  runListEmailSenders,
  LIST_EMAIL_SENDERS_TOOL,
} from "~/mcp/tools/admin/list-email-senders";
import type { McpCtx } from "~/mcp/registry";

function makeCtx(userId = "u1"): McpCtx {
  return {
    user: {
      id: userId,
      daliEmail: null,
      dartmouthEmail: null,
      netId: null,
      firstName: "Test",
      lastName: "User",
    },
    scopes: ["mcp:admin"],
    request: new Request("http://localhost/"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const HIRING_ROW = {
  id: "gi-hiring",
  purpose: "Hiring" as const,
  sendAsEmail: "hiring@cs.dartmouth.edu",
  enabled: true,
  linkedAt: new Date("2026-01-01T00:00:00Z"),
  lastUsedAt: new Date("2026-06-01T00:00:00Z"),
  syncError: null,
};

describe("list_email_senders", () => {
  it("requires the mcp:admin scope", () => {
    expect(LIST_EMAIL_SENDERS_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("throws McpForbiddenError when caller is not Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);

    await expect(runListEmailSenders(makeCtx())).rejects.toMatchObject({
      name: "McpForbiddenError",
      status: 403,
    });
  });

  it("returns senders with purpose metadata on happy path", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(listSenderIntegrations).mockResolvedValue([HIRING_ROW]);

    const out = await runListEmailSenders(makeCtx());
    expect(out.senders).toBeDefined();
    expect(Array.isArray(out.senders)).toBe(true);

    const hiringSender = out.senders.find((s) => s.purpose === "Hiring");
    expect(hiringSender).toBeDefined();
    expect(hiringSender!.integrationId).toBe("gi-hiring");
    expect(hiringSender!.sendAsEmail).toBe("hiring@cs.dartmouth.edu");
    expect(hiringSender!.linkedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(hiringSender!.syncError).toBeNull();
    expect(hiringSender!.fallbackEmail).toBeNull();
  });

  it("sets fallbackEmail to Hiring address for purposes with no linked sender", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(listSenderIntegrations).mockResolvedValue([HIRING_ROW]);

    const out = await runListEmailSenders(makeCtx());
    // Any purpose other than Hiring with no row should fall back to the Hiring sender
    const nonHiringSenders = out.senders.filter((s) => s.purpose !== "Hiring" && !s.integrationId);
    for (const s of nonHiringSenders) {
      expect(s.fallbackEmail).toBe("hiring@cs.dartmouth.edu");
    }
  });

  it("returns null integrationId for purposes with disabled rows", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(listSenderIntegrations).mockResolvedValue([
      { ...HIRING_ROW, enabled: false },
    ]);

    const out = await runListEmailSenders(makeCtx());
    const hiringSender = out.senders.find((s) => s.purpose === "Hiring");
    // Disabled row should not count
    expect(hiringSender!.integrationId).toBeNull();
  });
});
