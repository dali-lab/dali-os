import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(async () => false),
  forbidden: vi.fn(() => new Response("Forbidden", { status: 403 })),
}));
vi.mock("~/lib/db", () => ({
  prisma: { scheduledMeeting: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: vi.fn((_req: Request, res: Response) => res),
  handlePreflight: vi.fn(() => null),
}));
vi.mock("~/lib/scheduled-meeting", async (importOriginal) => {
  const real = await importOriginal<typeof import("~/lib/scheduled-meeting")>();
  return {
    tracksAttendance: real.tracksAttendance,
    parseOccurrenceParam: real.parseOccurrenceParam,
    markMeetingAttendance: vi.fn(),
  };
});

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { markMeetingAttendance } from "~/lib/scheduled-meeting";
import { action } from "../api.scheduled-meetings.$id.attendance";

const findMeeting = vi.mocked(prisma.scheduledMeeting.findUnique);

const typeless = {
  id: "m1",
  organizerId: "org-1",
  projectId: null,
  meetingType: null,
  notebookId: null,
  attendanceMode: "None",
  participantUserIds: [] as string[],
};

function post() {
  return action({
    request: new Request("http://os.test/api/scheduled-meetings/m1/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "u2", present: true }),
    }),
    params: { id: "m1" },
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "org-1" } } as never);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(markMeetingAttendance).mockResolvedValue({ ok: true } as never);
});

describe("POST /api/scheduled-meetings/:id/attendance", () => {
  it("404s a typeless meeting with no notebook, self check-in or guests", async () => {
    findMeeting.mockResolvedValue(typeless as never);
    expect((await post()).status).toBe(404);
    expect(markMeetingAttendance).not.toHaveBeenCalled();
  });

  it("admits a typeless meeting that has a notebook", async () => {
    findMeeting.mockResolvedValue({ ...typeless, notebookId: "nb-1" } as never);
    expect((await post()).status).toBe(200);
    expect(markMeetingAttendance).toHaveBeenCalled();
  });

  it("403s someone who is not the organizer, Core or a project member", async () => {
    findMeeting.mockResolvedValue({ ...typeless, notebookId: "nb-1", organizerId: "someone-else" } as never);
    expect((await post()).status).toBe(403);
    expect(markMeetingAttendance).not.toHaveBeenCalled();
  });
});
