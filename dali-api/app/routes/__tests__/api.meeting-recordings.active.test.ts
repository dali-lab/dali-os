import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn().mockResolvedValue({}) }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/meeting-recording.server", () => ({ documentTitle: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { documentTitle } from "~/lib/meeting-recording.server";
import { loader } from "~/routes/api.meeting-recordings.active";

const run = () =>
  loader({
    request: new Request("http://localhost/api/meeting-recordings/active"),
    params: {},
    context: {},
  } as never) as Promise<Response>;

const row = (over: Record<string, unknown> = {}) => ({
  id: "rec1",
  documentName: "doc:p1:body",
  status: "Recording",
  sessionStartedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u1", email: "u1@dali.edu", type: "member" },
    sessionId: "s1",
  } as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(documentTitle).mockResolvedValue("Weekly sync");
  vi.mocked(prisma.meetingRecording.findFirst).mockResolvedValue(null);
});

describe("GET /api/meeting-recordings/active", () => {
  it("is off without the flag", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect((await run()).status).toBe(403);
    expect(prisma.meetingRecording.findFirst).not.toHaveBeenCalled();
  });

  it("returns the auth response when signed out", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    expect((await run()).status).toBe(401);
  });

  it("returns null when the user has nothing on the go", async () => {
    const res = await run();
    expect(await res.json()).toEqual({ recording: null });
  });

  it("looks only at the caller's own, not-yet-inserted, unfinished rows", async () => {
    await run();
    expect(prisma.meetingRecording.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", status: { in: ["Pending", "Recording", "Stopped"] }, insertedAt: null },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("returns the live row with its note title and link, and no transcript fields", async () => {
    const startedAt = new Date(Date.now() - 90_000);
    vi.mocked(prisma.meetingRecording.findFirst).mockResolvedValue(row({ sessionStartedAt: startedAt }) as never);
    const { recording } = await (await run()).json();
    expect(recording).toMatchObject({
      id: "rec1",
      documentName: "doc:p1:body",
      status: "Recording",
      title: "Weekly sync",
      href: "/documents/p1",
    });
    expect(recording.sessionSeconds).toBeGreaterThanOrEqual(89);
    expect(Object.keys(recording).sort()).toEqual(["documentName", "href", "id", "sessionSeconds", "status", "title"]);
  });

  it("has no session length unless the row is Recording", async () => {
    vi.mocked(prisma.meetingRecording.findFirst).mockResolvedValue(
      row({ status: "Stopped", sessionStartedAt: new Date() }) as never,
    );
    expect((await (await run()).json()).recording.sessionSeconds).toBeNull();
  });

  it("calls an untitled note Untitled", async () => {
    vi.mocked(documentTitle).mockResolvedValue(null);
    vi.mocked(prisma.meetingRecording.findFirst).mockResolvedValue(row() as never);
    expect((await (await run()).json()).recording.title).toBe("Untitled");
  });

  it("links an interview's notes to the interview page, titled without the applicant's name", async () => {
    vi.mocked(prisma.meetingRecording.findFirst).mockResolvedValue(row({ documentName: "interview:i1:notes" }) as never);
    const { recording } = await (await run()).json();
    expect(recording.href).toBe("/hiring/interviews/i1");
    expect(recording.title).toBe("Interview");
    expect(documentTitle).not.toHaveBeenCalled();
  });

  it.each(["interview:i1:recommendation", "interview:i1:rec-notes-a1", "project:p1", "doc:"])(
    "gives %s no link and a generic title",
    async (documentName) => {
      vi.mocked(prisma.meetingRecording.findFirst).mockResolvedValue(row({ documentName }) as never);
      const { recording } = await (await run()).json();
      expect(recording.href).toBeNull();
      expect(recording.title).toBe("Recording");
      expect(documentTitle).not.toHaveBeenCalled();
    },
  );
});
