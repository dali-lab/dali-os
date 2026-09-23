// Gating for POST /api/ai/meeting-notes: flag, write access to the document's
// collab room, and the transcript sent to the model.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn().mockResolvedValue({}) }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/meeting-recording.server", () => ({
  canRecordInto: vi.fn(),
  documentTitle: vi.fn(),
}));
vi.mock("~/lib/ai-usage.server", () => ({ recordTokenUsage: vi.fn() }));
vi.mock("~/lib/ai.server", () => ({ generateShortText: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canRecordInto, documentTitle } from "~/lib/meeting-recording.server";
import { generateShortText } from "~/lib/ai.server";
import { _resetForTests as resetRateLimits } from "~/lib/rate-limit";
import { action } from "~/routes/api.ai.meeting-notes";

const DOC = "doc:p1:body";

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
  vi.mocked(canRecordInto).mockResolvedValue(true);
  vi.mocked(documentTitle).mockResolvedValue("Deserto sync");
  vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 1 } as never);
  vi.mocked(generateShortText).mockResolvedValue({
    text: "### Summary\nShipped.",
    inputTokens: 10,
    outputTokens: 5,
  });
});

describe("POST /api/ai/meeting-notes", () => {
  it("returns the model's notes, titled after the document", async () => {
    const res = await run({ documentName: DOC, transcript: "[00:01] You: we shipped it" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ markdown: "### Summary\nShipped." });
    expect(canRecordInto).toHaveBeenCalledWith("u1", DOC);
    expect(vi.mocked(generateShortText).mock.calls[0]![0].prompt).toContain("Document: Deserto sync");
  });

  it("works on documents that aren't Drive pages", async () => {
    vi.mocked(documentTitle).mockResolvedValue(null);
    const res = await run({ documentName: "interview:i1:notes", transcript: "x" });
    expect(res.status).toBe(200);
    expect(vi.mocked(generateShortText).mock.calls[0]![0].prompt).toMatch(/^Transcript:/);
  });

  it("rejects an empty transcript before calling the model", async () => {
    const res = await run({ documentName: DOC, transcript: "   " });
    expect(res.status).toBe(400);
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("is off without the flag", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect((await run({ documentName: DOC, transcript: "x" })).status).toBe(403);
  });

  it("needs write access to the document", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(false);
    expect((await run({ documentName: DOC, transcript: "x" })).status).toBe(403);
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("returns 503 when no AI provider is configured", async () => {
    vi.mocked(generateShortText).mockResolvedValue(null);
    expect((await run({ documentName: DOC, transcript: "x" })).status).toBe(503);
  });
});
