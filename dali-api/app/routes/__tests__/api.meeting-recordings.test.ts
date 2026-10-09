// POST /api/meeting-recordings: flag gate, the scheduledMeetingId resolution
// path (attachMeetingNote + recordingPolicy), and the lab-wide cap.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn().mockResolvedValue({}) }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/scheduled-meeting", () => ({ attachMeetingNote: vi.fn() }));
vi.mock("~/lib/meeting-recording.server", () => ({
  canRecordInto: vi.fn(),
  createRecording: vi.fn(),
  projectRecordingDisabled: vi.fn(),
  recordingDeepLink: (id: string) => `dalios://record?id=${id}`,
}));
vi.mock("~/lib/transcription/provider", () => ({ isTranscriptionEnabled: vi.fn().mockReturnValue(true) }));
vi.mock("~/lib/ai.server", () => ({ isAiEnabled: vi.fn().mockReturnValue(true) }));

import { requireAuth } from "~/lib/auth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { attachMeetingNote } from "~/lib/scheduled-meeting";
import {
  canRecordInto,
  createRecording,
  projectRecordingDisabled,
} from "~/lib/meeting-recording.server";
import { action } from "~/routes/api.meeting-recordings";

function post(body: unknown): Request {
  return new Request("http://localhost/api/meeting-recordings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const run = (body: unknown) =>
  action({ request: post(body), params: {}, context: {} } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u1", email: "u@dali.edu", type: "member" },
    sessionId: "s1",
  } as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(canRecordInto).mockResolvedValue(true);
  vi.mocked(projectRecordingDisabled).mockResolvedValue(false);
  vi.mocked(createRecording).mockResolvedValue({ id: "rec1" } as never);
});

describe("POST /api/meeting-recordings", () => {
  it("creates a recording directly from a documentName", async () => {
    const res = await run({ documentName: "doc:p1:body" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      id: "rec1",
      link: "dalios://record?id=rec1",
      transcriptionEnabled: true,
      aiEnabled: true,
    });
  });

  it("is off without the flag", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect((await run({ documentName: "doc:p1:body" })).status).toBe(403);
  });

  it("403s recordingDisabled when the meeting's project has recording off", async () => {
    vi.mocked(projectRecordingDisabled).mockResolvedValue(true);
    const res = await run({ documentName: "doc:p1:body", scheduledMeetingId: "m1" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "recordingDisabled" });
    expect(attachMeetingNote).not.toHaveBeenCalled();
  });

  it("resolves the note via attachMeetingNote when no documentName is given", async () => {
    vi.mocked(attachMeetingNote).mockResolvedValue({ ok: true, notePageId: "p1" });
    const res = await run({ scheduledMeetingId: "m1", occurrenceStart: "2026-10-09T15:00:00.000Z" });
    expect(res.status).toBe(201);
    expect(attachMeetingNote).toHaveBeenCalledWith(
      expect.objectContaining({ meetingId: "m1", actorId: "u1" }),
    );
    expect(canRecordInto).toHaveBeenCalledWith("u1", "doc:p1:body");
  });

  it("maps attachMeetingNote's 400 to noteRequired", async () => {
    vi.mocked(attachMeetingNote).mockResolvedValue({
      ok: false,
      error: "Choose what this meeting is about",
      status: 400,
    });
    const res = await run({ scheduledMeetingId: "m1" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "noteRequired" });
  });

  it("maps attachMeetingNote's 403 to forbidden", async () => {
    vi.mocked(attachMeetingNote).mockResolvedValue({
      ok: false,
      error: "Only the organizer or Core can add notes",
      status: 403,
    });
    const res = await run({ scheduledMeetingId: "m1" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("503s with a friendly message at the lab-wide cap", async () => {
    vi.mocked(createRecording).mockResolvedValue(null);
    const res = await run({ documentName: "doc:p1:body" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/try again/i);
  });

  it("requires documentName or a resolvable scheduledMeetingId", async () => {
    const res = await run({});
    expect(res.status).toBe(400);
  });
});
