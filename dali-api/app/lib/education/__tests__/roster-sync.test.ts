import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/scheduled-meeting", () => ({
  createScheduledMeeting: vi.fn().mockResolvedValue({
    ok: true,
    meeting: { id: "meeting-new", externalEventId: null },
    notifiedCount: 0,
    gcalError: null,
  }),
  updateScheduledMeetingParticipants: vi.fn().mockResolvedValue({
    ok: true,
    added: [],
    removed: [],
    gcalError: null,
  }),
}));

import { prisma } from "~/lib/db";
import {
  createScheduledMeeting,
  updateScheduledMeetingParticipants,
} from "~/lib/scheduled-meeting";
import { syncSessionRoster } from "~/lib/education/roster-sync";

const mockPrisma = prisma as unknown as {
  educationOffering: { findUnique: ReturnType<typeof vi.fn> };
  educationApplication: { findMany: ReturnType<typeof vi.fn> };
  educationSession: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
  userCalendarLink: { findFirst: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.educationOffering.findUnique.mockResolvedValue({
    id: "off-1",
    title: "Intro",
    calendarEmail: "edu@dali",
    instructors: [{ userId: "instructor-1" }],
  });
  mockPrisma.educationApplication.findMany.mockResolvedValue([
    { applicantUserId: "stu-1" },
    { applicantUserId: "stu-2" },
  ]);
  mockPrisma.user.findUnique.mockResolvedValue({
    daliEmail: "instructor@dali",
    dartmouthEmail: null,
  });
  mockPrisma.userCalendarLink.findFirst.mockResolvedValue(null);
});

describe("syncSessionRoster", () => {
  it("creates a ScheduledMeeting for each future session that lacks one", async () => {
    mockPrisma.educationSession.findMany.mockResolvedValue([
      {
        id: "sess-1",
        datetime: new Date(Date.now() + 86_400_000),
        scheduledMeetingId: null,
      },
    ]);

    const result = await syncSessionRoster("off-1");
    expect(createScheduledMeeting).toHaveBeenCalledOnce();
    expect(mockPrisma.educationSession.update).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: { scheduledMeetingId: "meeting-new" },
    });
    expect(result.meetingsCreated).toBe(1);
  });

  it("updates existing meetings with the latest roster", async () => {
    mockPrisma.educationSession.findMany.mockResolvedValue([
      {
        id: "sess-2",
        datetime: new Date(Date.now() + 3600_000),
        scheduledMeetingId: "meeting-existing",
      },
    ]);
    (updateScheduledMeetingParticipants as any).mockResolvedValueOnce({
      ok: true,
      added: ["stu-2"],
      removed: [],
      gcalError: null,
    });

    const result = await syncSessionRoster("off-1");
    expect(updateScheduledMeetingParticipants).toHaveBeenCalledWith(
      "meeting-existing",
      ["stu-1", "stu-2"],
    );
    expect(result.meetingsUpdated).toBe(1);
  });

  it("does nothing when there are no future sessions", async () => {
    mockPrisma.educationSession.findMany.mockResolvedValue([]);
    const result = await syncSessionRoster("off-1");
    expect(result.meetingsCreated).toBe(0);
    expect(result.meetingsUpdated).toBe(0);
    expect(createScheduledMeeting).not.toHaveBeenCalled();
  });
});
