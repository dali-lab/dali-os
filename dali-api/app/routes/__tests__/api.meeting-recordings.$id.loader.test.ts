// GET /api/meeting-recordings/:id — owner vs. viewer shape, and that both
// resolve `speakers` to display names in `speakerNames` (Fix for the speaker
// chip showing a raw userId when the assignment came from outside the
// occurrence roster, e.g. a mentions-search pick made on another device).

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/collabAuth", () => ({ authorizeCollabDoc: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { authorizeCollabDoc } from "~/lib/collabAuth";
import { loader } from "~/routes/api.meeting-recordings.$id";

function get(): Request {
  return new Request("http://localhost/api/meeting-recordings/rec1");
}

const run = () => loader({ request: get(), params: { id: "rec1" }, context: {} } as never) as Promise<Response>;

const userId = "c" + "z".repeat(24); // cuid-shaped, matches resolveSpeakerNames' heuristic

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u1", email: "u1@dali.edu", firstName: "Owner", lastName: "User", type: "member" },
    sessionId: "s1",
  } as never);
  vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
    id: "rec1",
    userId: "u1",
    documentName: "doc:p1:body",
    status: "Done",
    stopRequested: false,
    channels: ["mic"],
    segmentStarts: [0],
    recordedSeconds: 42,
    error: null,
    speakers: { "mic:1": userId },
    lines: [{ at: 1, end: 2, text: "hi", channel: "mic", speaker: "mic:1" }],
    insertedAt: null,
    finalizedAt: new Date("2026-10-10T00:00:00Z"),
    notes: null,
    enhancedAt: null,
    enhancedBy: null,
  } as never);
  vi.mocked(prisma.user.findMany).mockResolvedValue([
    { id: userId, firstName: "Priya", lastName: "Shah" },
  ] as never);
});

describe("GET /api/meeting-recordings/:id", () => {
  it("404s when the recording doesn't exist", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue(null);
    expect((await run()).status).toBe(404);
  });

  it("404s a viewer with no access to the note", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { sub: "u2", email: "u2@dali.edu", type: "member" },
      sessionId: "s2",
    } as never);
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: false, readOnly: false });
    expect((await run()).status).toBe(404);
  });

  it("gives the owner the fuller shape, with speakers resolved to names", async () => {
    const res = await run();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.stopRequested).toBe(false);
    expect(json.speakers).toEqual({ "mic:1": userId });
    expect(json.speakerNames).toEqual({ "mic:1": "Priya Shah" });
    expect(json.reviewedAt).toBeNull();
  });

  it("gives a non-owner viewer the read-only shape, also with speakerNames resolved", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { sub: "u2", email: "u2@dali.edu", type: "member" },
      sessionId: "s2",
    } as never);
    vi.mocked(authorizeCollabDoc).mockResolvedValue({ allowed: true, readOnly: true });
    const res = await run();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.stopRequested).toBeUndefined();
    expect(json.speakerNames).toEqual({ "mic:1": "Priya Shah" });
    expect(json.reviewedAt).toBeNull();
  });

  it("surfaces notes.reviewedAt for both the owner and a viewer", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
      id: "rec1",
      userId: "u1",
      documentName: "doc:p1:body",
      status: "Done",
      stopRequested: false,
      channels: ["mic"],
      segmentStarts: [0],
      recordedSeconds: 42,
      error: null,
      speakers: {},
      lines: [],
      insertedAt: null,
      finalizedAt: new Date("2026-10-10T00:00:00Z"),
      notes: { reviewedAt: "2026-10-10T00:10:00.000Z" },
      enhancedAt: new Date("2026-10-10T00:05:00Z"),
      enhancedBy: "Ada Lovelace",
    } as never);
    const res = await run();
    const json = await res.json();
    expect(json.reviewedAt).toBe("2026-10-10T00:10:00.000Z");
  });

  it("passes free-text speaker assignments through speakerNames unchanged", async () => {
    vi.mocked(prisma.meetingRecording.findUnique).mockResolvedValue({
      id: "rec1",
      userId: "u1",
      documentName: "doc:p1:body",
      status: "Done",
      stopRequested: false,
      channels: ["mic"],
      segmentStarts: [0],
      recordedSeconds: 42,
      error: null,
      speakers: { "mic:1": "A guest" },
      lines: [],
      insertedAt: null,
      finalizedAt: null,
      notes: null,
      enhancedAt: null,
      enhancedBy: null,
    } as never);
    const res = await run();
    const json = await res.json();
    expect(json.speakerNames).toEqual({ "mic:1": "A guest" });
  });
});
