// Gating for POST /api/ai/meeting-notes: flag, meeting-note page, edit access,
// and the transcript sent to the model.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn().mockResolvedValue({}) }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/ai-usage.server", () => ({ recordTokenUsage: vi.fn() }));
vi.mock("~/lib/ai.server", () => ({ generateShortText: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { generateShortText } from "~/lib/ai.server";
import { _resetForTests as resetRateLimits } from "~/lib/rate-limit";
import { action } from "~/routes/api.ai.meeting-notes";

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/meeting-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const run = (body: unknown) =>
  action({ request: post(body), params: {}, context: {} } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u1", email: "u@dali.edu", type: "member" },
    sessionId: "s1",
  } as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(prisma.page.findUnique).mockResolvedValue({
    meetingNoteId: "m1",
    title: "Team meeting note",
    meetingNote: { title: "Deserto sync" },
  } as never);
  vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: true } as never);
  vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 1 } as never);
  vi.mocked(generateShortText).mockResolvedValue({
    text: "### Summary\nShipped.",
    inputTokens: 10,
    outputTokens: 5,
  });
});

describe("POST /api/ai/meeting-notes", () => {
  it("returns the model's notes for the meeting", async () => {
    const res = await run({ pageId: "p1", transcript: "[00:01] we shipped it" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ markdown: "### Summary\nShipped." });
    expect(vi.mocked(generateShortText).mock.calls[0]![0].prompt).toContain("Deserto sync");
  });

  it("rejects an empty transcript before calling the model", async () => {
    const res = await run({ pageId: "p1", transcript: "   " });
    expect(res.status).toBe(400);
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("is off without the flag", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect((await run({ pageId: "p1", transcript: "x" })).status).toBe(403);
  });

  it("only works on meeting notes", async () => {
    vi.mocked(prisma.page.findUnique).mockResolvedValue({ meetingNoteId: null } as never);
    expect((await run({ pageId: "p1", transcript: "x" })).status).toBe(404);
  });

  it("needs edit access to the note", async () => {
    vi.mocked(getPageAccess).mockResolvedValue({ canView: true, canEdit: false } as never);
    expect((await run({ pageId: "p1", transcript: "x" })).status).toBe(403);
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("returns 503 when no AI provider is configured", async () => {
    vi.mocked(generateShortText).mockResolvedValue(null);
    expect((await run({ pageId: "p1", transcript: "x" })).status).toBe(503);
  });
});
