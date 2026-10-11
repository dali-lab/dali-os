// MCP `enhance_meeting_notes` — specs/meeting-notes-model.md §2, §4, §6.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError };
});
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn().mockResolvedValue({}) }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/meeting-recording.server", () => ({
  canRecordInto: vi.fn(),
  storedLines: vi.fn().mockReturnValue([]),
}));
vi.mock("~/collab/server", () => ({ getCollabServer: vi.fn() }));
vi.mock("~/collab/persistence", () => ({ forceSnapshot: vi.fn() }));
vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn() }));
vi.mock("~/collab/write", () => ({ replaceCollabDocContent: vi.fn() }));
vi.mock("~/lib/meeting-notes-enhance.server", () => ({
  generateAndVerifyEnhancePlan: vi.fn(),
  resolveMeetingEnhanceContext: vi.fn().mockResolvedValue({ roster: [], meetingTypeLabel: "Meeting", occurrenceDate: "2026-10-10" }),
}));
vi.mock("~/lib/meeting-notes-apply.server", () => ({
  applyEnhanceOpsToDocBlocks: vi.fn((_ops: unknown, blocks: unknown) => blocks),
  ensureTranscriptToggle: vi.fn((blocks: unknown) => blocks),
}));

import { prisma } from "~/lib/db";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canRecordInto } from "~/lib/meeting-recording.server";
import { getCollabServer } from "~/collab/server";
import { forceSnapshot } from "~/collab/persistence";
import { readDocAsBlocks } from "~/collab/read";
import { replaceCollabDocContent } from "~/collab/write";
import { generateAndVerifyEnhancePlan } from "~/lib/meeting-notes-enhance.server";
import { _resetForTests as resetRateLimits } from "~/lib/rate-limit";
import {
  runEnhanceMeetingNotes,
  ENHANCE_MEETING_NOTES_DEF,
} from "~/mcp/tools/calendar-extra/enhance-meeting-notes";

const mockPrisma = prisma as unknown as {
  meetingRecording: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  page: { findUnique: ReturnType<typeof vi.fn> };
};

function ctxFor(userId: string) {
  return {
    user: { id: userId, daliEmail: `${userId}@dali.edu`, dartmouthEmail: null, netId: null, firstName: "Ada", lastName: "Lovelace" },
    scopes: ["mcp:write"],
    request: new Request("http://localhost/mcp"),
  } as never;
}

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec1",
    documentName: "doc:p1:body",
    scheduledMeetingId: null,
    occurrenceStart: null,
    createdAt: new Date("2026-10-10T00:00:00.000Z"),
    speakers: {},
    notes: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.mocked(getUserRoles).mockResolvedValue({} as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(canRecordInto).mockResolvedValue(true);
  mockPrisma.meetingRecording.findUnique.mockResolvedValue(recording());
  mockPrisma.meetingRecording.update.mockResolvedValue({});
  mockPrisma.page.findUnique.mockResolvedValue({ seededFromPageId: null, seededTemplateHash: null });
  vi.mocked(readDocAsBlocks).mockResolvedValue([]);
  vi.mocked(getCollabServer).mockReturnValue({} as never);
});

describe("enhance_meeting_notes", () => {
  it("requires mcp:write scope", () => {
    expect(ENHANCE_MEETING_NOTES_DEF.requiredScope).toBe("mcp:write");
  });

  it("denies a caller without edit access to the note", async () => {
    vi.mocked(canRecordInto).mockResolvedValue(false);
    await expect(runEnhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1" })).rejects.toMatchObject({
      name: "McpForbiddenError",
    });
    expect(generateAndVerifyEnhancePlan).not.toHaveBeenCalled();
  });

  it("denies when the ai-meeting-notes flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    await expect(runEnhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1" })).rejects.toMatchObject({
      name: "McpForbiddenError",
    });
  });

  it("404s when the recording doesn't exist", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(null);
    await expect(runEnhanceMeetingNotes(ctxFor("u1"), { recordingId: "missing" })).rejects.toMatchObject({
      name: "McpNotFoundError",
    });
  });

  it("preview (apply omitted) returns the verified plan shape", async () => {
    vi.mocked(generateAndVerifyEnhancePlan).mockResolvedValue({
      ok: true,
      notes: {
        plan: { blocks: [{ id: "b1", op: "keep" }], actionItems: [] },
        verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
        snapshotAt: "2026-10-10T00:00:00.000Z",
        snapshot: [{ id: "b1", type: "paragraph", text: "hi" }],
      },
    } as never);

    const result = await runEnhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1" });

    expect(result).toEqual({
      plan: { blocks: [{ id: "b1", op: "keep" }], actionItems: [] },
      verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
      snapshotAt: "2026-10-10T00:00:00.000Z",
    });
    // Preview never writes to the doc.
    expect(replaceCollabDocContent).not.toHaveBeenCalled();
    expect(forceSnapshot).not.toHaveBeenCalled();
  });

  it("preview surfaces the generation error (e.g. nothing transcribed)", async () => {
    vi.mocked(generateAndVerifyEnhancePlan).mockResolvedValue({
      ok: false,
      status: 400,
      error: "Nothing was transcribed.",
    } as never);
    await expect(runEnhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1" })).rejects.toMatchObject({
      status: 400,
      message: "Nothing was transcribed.",
    });
  });

  it("apply requires a stored preview to exist", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(recording({ notes: null }));
    await expect(
      runEnhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1", apply: true }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
    expect(forceSnapshot).not.toHaveBeenCalled();
  });

  it("apply refuses (409) when a newer preview landed after the one being applied", async () => {
    const stored = {
      plan: { blocks: [], actionItems: [] },
      verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
      snapshotAt: "2026-10-10T00:00:00.000Z",
      snapshot: [],
    };
    mockPrisma.meetingRecording.findUnique.mockImplementation((args: { select?: { notes?: boolean } }) => {
      if (args?.select?.notes) {
        // A newer preview (later snapshotAt) landed while this apply was computing.
        return Promise.resolve({ notes: { ...stored, snapshotAt: "2026-10-10T00:05:00.000Z" } });
      }
      return Promise.resolve(recording({ notes: stored }));
    });

    await expect(
      runEnhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1", apply: true }),
    ).rejects.toMatchObject({ status: 409 });

    expect(replaceCollabDocContent).not.toHaveBeenCalled();
    expect(mockPrisma.meetingRecording.update).not.toHaveBeenCalled();
  });

  it("apply merges, inserts the transcript toggle, and stamps enhancedAt/enhancedBy when not stale", async () => {
    const stored = {
      plan: { blocks: [], actionItems: [] },
      verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
      snapshotAt: "2026-10-10T00:00:00.000Z",
      snapshot: [],
    };
    mockPrisma.meetingRecording.findUnique.mockImplementation((args: { select?: { notes?: boolean } }) => {
      if (args?.select?.notes) return Promise.resolve({ notes: stored });
      return Promise.resolve(recording({ notes: stored }));
    });

    const result = await runEnhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1", apply: true });

    expect(forceSnapshot).toHaveBeenCalledWith(expect.anything(), "doc:p1:body", "Before enhance", ["u1"]);
    expect(replaceCollabDocContent).toHaveBeenCalledWith("doc:p1:body", [], "u1");
    expect(mockPrisma.meetingRecording.update).toHaveBeenCalledWith({
      where: { id: "rec1" },
      data: { enhancedAt: expect.any(Date), enhancedBy: "Ada Lovelace" },
    });
    expect(result).toMatchObject({ applied: true, enhancedBy: "Ada Lovelace" });
  });

  it("apply 503s when the collab server isn't running in this process", async () => {
    vi.mocked(getCollabServer).mockReturnValue(null as never);
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(
      recording({
        notes: {
          plan: { blocks: [], actionItems: [] },
          verified: { droppedCites: 0, droppedBlocks: 0, unmatchedOwners: 0 },
          snapshotAt: "2026-10-10T00:00:00.000Z",
          snapshot: [],
        },
      }),
    );
    await expect(
      runEnhanceMeetingNotes(ctxFor("u1"), { recordingId: "rec1", apply: true }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
