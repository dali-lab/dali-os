// Gating + plan verification wiring for POST /api/ai/meeting-notes/enhance.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/meeting-recording.server", () => ({
  canRecordInto: vi.fn(),
  formatRecordingTranscript: vi.fn().mockResolvedValue("[00:01] You: we shipped it"),
  storedLines: vi.fn(),
}));
vi.mock("~/lib/ai-usage.server", () => ({ recordTokenUsage: vi.fn() }));
vi.mock("~/lib/ai.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/ai.server")>()),
  generateShortText: vi.fn(),
  resolveAiProvider: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
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

  it("asks the model for up to 16k output tokens", async () => {
    await run(BODY);
    expect(vi.mocked(generateShortText).mock.calls[0]![0].maxTokens).toBe(16_000);
  });

  it("422s with a clear error when the model hits the output cap, and stores nothing", async () => {
    vi.mocked(generateShortText).mockResolvedValue({
      text: VALID_MODEL_JSON.slice(0, 20),
      inputTokens: 1,
      outputTokens: 16_000,
      stopReason: "max_tokens",
    });
    const res = await run(BODY);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("This meeting is too long to enhance in one pass.");
    expect(prisma.meetingRecording.update).not.toHaveBeenCalled();
  });

  it("parses normally when the model stops on its own", async () => {
    vi.mocked(generateShortText).mockResolvedValue({
      text: VALID_MODEL_JSON,
      inputTokens: 1,
      outputTokens: 1,
      stopReason: "end_turn",
    });
    expect((await run(BODY)).status).toBe(200);
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

  it("409s when the client reports marks still pending review", async () => {
    const res = await run({ ...BODY, hasMarks: true });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("Keep or revert the current changes first");
    expect(generateShortText).not.toHaveBeenCalled();
  });

  it("proceeds normally when hasMarks is false or omitted", async () => {
    expect((await run({ ...BODY, hasMarks: false })).status).toBe(200);
    expect((await run(BODY)).status).toBe(200);
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

describe("interview notes", () => {
  const INTERVIEW_DOC = "interview:iv1:notes";
  const WITH_ACTION_ITEM = JSON.stringify({
    blocks: [{ id: "b1", op: "keep" }],
    actionItems: [{ text: "Send the take-home", cites: [1] }],
  });

  beforeEach(() => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
      id: "rec1",
      userId: "u1",
      documentName: INTERVIEW_DOC,
      scheduledMeetingId: null,
      occurrenceStart: null,
      createdAt: new Date("2026-10-10T00:00:00Z"),
    } as never);
    vi.mocked(prisma.interview.findUnique).mockResolvedValue({
      startTime: new Date("2026-11-03T15:00:00Z"),
      assignments: [
        { cycleInterviewer: { user: { id: "u1", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" } } },
        { cycleInterviewer: { user: { id: "u2", firstName: "Alan", lastName: "Turing", daliEmail: "alan@example.edu" } } },
      ],
    } as never);
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
  });

  it("uses the interview prompt with the active interviewers and interview date", async () => {
    expect((await run(BODY)).status).toBe(200);
    const { system, prompt } = vi.mocked(generateShortText).mock.calls[0]![0];
    expect(system).toMatch(/^You enhance a hiring interview's notes/);
    expect(system).toContain("Record, never judge.");
    expect(prompt).toContain("Interview date: 2026-11-03");
    expect(prompt).toContain("Interviewers:\nAda Lovelace\nAlan Turing");
    expect(prompt).not.toContain("Recorder");
    expect(prompt).not.toContain("Meeting type");
    expect(vi.mocked(prisma.interview.findUnique).mock.calls[0]![0]).toMatchObject({
      where: { id: "iv1" },
      select: { assignments: { where: { status: "Active" } } },
    });
  });

  it("drops action items the model returns anyway", async () => {
    vi.mocked(generateShortText).mockResolvedValue({ text: WITH_ACTION_ITEM, inputTokens: 1, outputTokens: 1 });
    const res = await run(BODY);
    expect(res.status).toBe(200);
    expect((await res.json()).plan.actionItems).toEqual([]);
    const stored = vi.mocked(prisma.meetingRecording.update).mock.calls[0]![0].data.notes as {
      plan: { actionItems: unknown[] };
    };
    expect(stored.plan.actionItems).toEqual([]);
  });

  it("falls back to the recording date and no interviewers when the interview is gone", async () => {
    vi.mocked(prisma.interview.findUnique).mockResolvedValue(null);
    expect((await run(BODY)).status).toBe(200);
    const { prompt } = vi.mocked(generateShortText).mock.calls[0]![0];
    expect(prompt).toContain("Interview date: 2026-10-10");
    expect(prompt).toContain("Interviewers: (none on record)");
  });

  it("treats the interview's recommendation room as a regular note", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
      id: "rec1",
      userId: "u1",
      documentName: "interview:iv1:recommendation",
      scheduledMeetingId: null,
      occurrenceStart: null,
      createdAt: new Date("2026-10-10T00:00:00Z"),
    } as never);
    await run(BODY);
    expect(vi.mocked(generateShortText).mock.calls[0]![0].system).toMatch(/^You enhance meeting notes/);
  });
});

describe("regular meeting notes", () => {
  it("keep the meeting prompt and action items", async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as never);
    vi.mocked(generateShortText).mockResolvedValue({
      text: JSON.stringify({ blocks: [{ id: "b1", op: "keep" }], actionItems: [{ text: "Ship it", cites: [1] }] }),
      inputTokens: 1,
      outputTokens: 1,
    });
    const res = await run(BODY);
    const { system, prompt } = vi.mocked(generateShortText).mock.calls[0]![0];
    expect(system).toMatch(/^You enhance meeting notes/);
    expect(prompt).toContain('Recorder (speaks as "You")');
    expect((await res.json()).plan.actionItems).toHaveLength(1);
    expect(prisma.interview.findUnique).not.toHaveBeenCalled();
  });
});
