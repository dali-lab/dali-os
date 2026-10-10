// Gating + plan verification wiring for POST /api/ai/meeting-notes/enhance.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn().mockResolvedValue({}) }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/meeting-recording.server", () => ({
  canRecordInto: vi.fn(),
  formatRecordingTranscript: vi.fn().mockResolvedValue("[00:01] You: we shipped it"),
  storedLines: vi.fn(),
}));
vi.mock("~/lib/ai-usage.server", () => ({ recordTokenUsage: vi.fn() }));
vi.mock("~/lib/ai.server", () => ({
  generateShortText: vi.fn(),
  resolveAiProvider: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canRecordInto, storedLines } from "~/lib/meeting-recording.server";
import { generateShortText, resolveAiProvider } from "~/lib/ai.server";
import { _resetForTests as resetRateLimits } from "~/lib/rate-limit";
import { action } from "~/routes/api.ai.meeting-notes.enhance";

const DOC = "doc:p1:body";
const LINES = [{ at: 1, end: 3, text: "we shipped it", channel: "mic" as const }];
const BLOCKS = [{ id: "b1", type: "paragraph", text: "Shipped" }];

function post(body: unknown): Request {
  return new Request("http://localhost/api/ai/meeting-notes/enhance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const run = (body: unknown) =>
  action({ request: post(body), params: {}, context: {} } as never) as Promise<Response>;

const VALID_MODEL_JSON = JSON.stringify({
  blocks: [{ id: "b1", op: "keep" }],
  actionItems: [],
});

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
  vi.mocked(storedLines).mockReturnValue(LINES as never);
  vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
    id: "rec1",
    documentName: DOC,
    scheduledMeetingId: null,
    occurrenceStart: null,
    createdAt: new Date("2026-10-10T00:00:00Z"),
  } as never);
  vi.mocked(prisma.aiUsage.upsert).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.meetingRecording.update).mockResolvedValue({} as never);
  vi.mocked(resolveAiProvider).mockReturnValue({ sonnetModel: "claude-sonnet-5" } as never);
  vi.mocked(generateShortText).mockResolvedValue({ text: VALID_MODEL_JSON, inputTokens: 10, outputTokens: 5 });
});

const BODY = { recordingId: "rec1", blocks: BLOCKS, untouchedTemplate: false };

describe("POST /api/ai/meeting-notes/enhance", () => {
  it("returns the verified plan and stores it on the recording", async () => {
    const res = await run(BODY);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.plan).toEqual({ blocks: [{ id: "b1", op: "keep" }], actionItems: [] });
    expect(json.verified).toEqual({ droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 });
    expect(typeof json.snapshotAt).toBe("string");
    expect(json.snapshot).toEqual(BLOCKS);
    expect(prisma.meetingRecording.update).toHaveBeenCalledWith({
      where: { id: "rec1" },
      data: { notes: expect.objectContaining({ plan: json.plan, snapshotAt: json.snapshotAt, snapshot: BLOCKS }) },
    });
  });

  it("404s an unknown recordingId", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(null);
    expect((await run(BODY)).status).toBe(404);
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("is off without the flag", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect((await run(BODY)).status).toBe(403);
  });

  it("needs write access to the document", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(false);
    expect((await run(BODY)).status).toBe(403);
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("rejects a recording with no transcript before calling the model", async () => {
    vi.mocked(storedLines).mockReturnValue([]);
    const res = await run(BODY);
    expect(res.status).toBe(400);
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("returns 503 when no AI provider is configured", async () => {
    vi.mocked(resolveAiProvider).mockReturnValue(null);
    expect((await run(BODY)).status).toBe(503);
  });

  it("502s when the model's response isn't valid JSON", async () => {
    vi.mocked(generateShortText).mockResolvedValue({ text: "not json", inputTokens: 1, outputTokens: 1 });
    const res = await run(BODY);
    expect(res.status).toBe(502);
    expect(prisma.meetingRecording.update).not.toHaveBeenCalled();
  });

  it("502s when the model's JSON doesn't match the expected shape", async () => {
    vi.mocked(generateShortText).mockResolvedValue({
      text: JSON.stringify({ blocks: "nope" }),
      inputTokens: 1,
      outputTokens: 1,
    });
    expect((await run(BODY)).status).toBe(502);
  });

  it("strips markdown code fences before parsing", async () => {
    vi.mocked(generateShortText).mockResolvedValue({
      text: "```json\n" + VALID_MODEL_JSON + "\n```",
      inputTokens: 1,
      outputTokens: 1,
    });
    expect((await run(BODY)).status).toBe(200);
  });

  it("rejects a malformed request body", async () => {
    const res = await run({ recordingId: "rec1" });
    expect(res.status).toBe(400);
    expect(generateShortText).not.toHaveBeenCalled();
  });
});

// A re-run (Enhance again) stores a fresh plan with no taskIds — Create tasks
// would otherwise duplicate every task already made for the previous plan
// (specs/meeting-notes-model.md §5).
describe("carrying a taskId forward across a re-run", () => {
  const ACTION_ITEM_JSON = JSON.stringify({
    blocks: [{ id: "b1", op: "keep" }],
    actionItems: [{ text: "Send the revised scope", cites: [1] }],
  });

  // vi.clearAllMocks() (the file's own beforeEach) clears call history but not
  // a mockResolvedValue set by an earlier test — reset explicitly so these
  // tests don't leak into each other.
  beforeEach(() => {
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
  });

  it("matches the previous plan's item by normalized text, even with an owner prefix", async () => {
    vi.mocked(generateShortText).mockResolvedValue({ text: ACTION_ITEM_JSON, inputTokens: 1, outputTokens: 1 });
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
      id: "rec1",
      documentName: DOC,
      userId: "u1",
      scheduledMeetingId: null,
      occurrenceStart: null,
      createdAt: new Date("2026-10-10T00:00:00Z"),
      notes: {
        plan: {
          blocks: [],
          actionItems: [{ text: "Ada: Send the revised scope", cites: [1], taskId: "task-old" }],
        },
        verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
        snapshotAt: "2026-10-09T00:00:00.000Z",
        snapshot: [],
      },
    } as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);

    const res = await run(BODY);
    const json = await res.json();
    expect(json.plan.actionItems[0]).toMatchObject({ taskId: "task-old" });
  });

  it("falls back to an existing Task from this recording whose title matches, when no previous plan item does", async () => {
    vi.mocked(generateShortText).mockResolvedValue({ text: ACTION_ITEM_JSON, inputTokens: 1, outputTokens: 1 });
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      { id: "task-existing", title: "Send the revised scope" },
    ] as never);

    const res = await run(BODY);
    const json = await res.json();
    expect(json.plan.actionItems[0]).toMatchObject({ taskId: "task-existing" });
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: { sourceRecordingId: "rec1" },
      select: { id: true, title: true },
    });
  });

  it("leaves taskId unset when nothing matches", async () => {
    vi.mocked(generateShortText).mockResolvedValue({ text: ACTION_ITEM_JSON, inputTokens: 1, outputTokens: 1 });
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);

    const res = await run(BODY);
    const json = await res.json();
    expect(json.plan.actionItems[0].taskId).toBeUndefined();
  });
});
