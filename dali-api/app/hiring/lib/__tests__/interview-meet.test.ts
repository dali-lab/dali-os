import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    userCalendarLink: { findFirst: vi.fn(), update: vi.fn() },
    interview: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("~/lib/google-calendar", () => ({
  createGoogleCalendarEvent: vi.fn(),
  deleteGoogleCalendarEvent: vi.fn(),
  getGoogleEventMeetUrl: vi.fn(),
  patchGoogleCalendarEvent: vi.fn(),
}));

import { prisma } from "~/lib/db";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  getGoogleEventMeetUrl,
} from "~/lib/google-calendar";
import {
  deprovisionInterviewMeet,
  ensureInterviewMeetUrl,
  provisionInterviewMeet,
} from "~/hiring/lib/interview-meet";

const db = prisma as any;
const LINK = { id: "link-hiring" };

const onlineInterview = {
  id: "iv1",
  roomId: null,
  calendarEventId: null,
  startTime: new Date("2026-11-02T15:00:00Z"),
  endTime: new Date("2026-11-02T15:30:00Z"),
  domainApplication: {
    domain: { name: "Design" },
    application: { user: { firstName: "Bob", lastName: "Lee", dartmouthEmail: "bob@dartmouth.edu", netId: null } },
  },
  assignments: [
    { cycleInterviewer: { user: { firstName: "Ada", lastName: "L", daliEmail: "ada@dali.dartmouth.edu" } } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.userCalendarLink.findFirst.mockResolvedValue(LINK);
  db.userCalendarLink.update.mockResolvedValue({});
  db.interview.update.mockResolvedValue({});
});

describe("ensureInterviewMeetUrl", () => {
  it("returns the stored link without touching Google", async () => {
    const url = await ensureInterviewMeetUrl({ id: "iv1", calendarEventId: "evt", videoUrl: "https://meet/x" });
    expect(url).toBe("https://meet/x");
    expect(getGoogleEventMeetUrl).not.toHaveBeenCalled();
  });

  it("does nothing for an interview with no event (in person, or never provisioned)", async () => {
    expect(await ensureInterviewMeetUrl({ id: "iv1", calendarEventId: null, videoUrl: null })).toBeNull();
    expect(getGoogleEventMeetUrl).not.toHaveBeenCalled();
  });

  it("picks up a link Google minted after the insert and stores it", async () => {
    vi.mocked(getGoogleEventMeetUrl).mockResolvedValue("https://meet.google.com/abc");
    const url = await ensureInterviewMeetUrl({ id: "iv1", calendarEventId: "evt", videoUrl: null });
    expect(url).toBe("https://meet.google.com/abc");
    expect(db.interview.update).toHaveBeenCalledWith({
      where: { id: "iv1" },
      data: { videoUrl: "https://meet.google.com/abc", videoProvider: "GoogleMeet" },
    });
    expect(db.userCalendarLink.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: LINK.id }, data: expect.objectContaining({ syncError: null }) }),
    );
  });

  it("leaves the row alone while Google still has no link", async () => {
    vi.mocked(getGoogleEventMeetUrl).mockResolvedValue(null);
    expect(await ensureInterviewMeetUrl({ id: "iv1", calendarEventId: "evt", videoUrl: null })).toBeNull();
    expect(db.interview.update).not.toHaveBeenCalled();
  });
});

describe("hiring calendar link health", () => {
  it("records a Google failure on the hiring link so the admin can see it", async () => {
    db.interview.findUnique.mockResolvedValue(onlineInterview);
    vi.mocked(createGoogleCalendarEvent).mockRejectedValue(new Error("invalid_grant: Token has been revoked"));
    await provisionInterviewMeet("iv1");
    expect(db.interview.update).not.toHaveBeenCalled();
    expect(db.userCalendarLink.update).toHaveBeenCalledWith({
      where: { id: LINK.id },
      data: { syncError: "invalid_grant: Token has been revoked" },
    });
  });

  it("clears the recorded failure on the next success", async () => {
    db.interview.findUnique.mockResolvedValue(onlineInterview);
    vi.mocked(createGoogleCalendarEvent).mockResolvedValue({
      eventId: "evt",
      iCalUID: null,
      htmlLink: null,
      meetUrl: null,
    });
    await provisionInterviewMeet("iv1");
    // The event id is kept even when the link is still pending.
    expect(db.interview.update).toHaveBeenCalledWith({
      where: { id: "iv1" },
      data: { calendarEventId: "evt", videoUrl: null, videoProvider: "GoogleMeet" },
    });
    expect(db.userCalendarLink.update).toHaveBeenCalledWith({
      where: { id: LINK.id },
      data: { syncError: null, lastSyncedAt: expect.any(Date) },
    });
  });

  it("still clears the row when the event is already gone on Google", async () => {
    vi.mocked(deleteGoogleCalendarEvent).mockResolvedValue(undefined);
    await deprovisionInterviewMeet({ id: "iv1", calendarEventId: "evt" });
    expect(db.interview.update).toHaveBeenCalledWith({
      where: { id: "iv1" },
      data: { calendarEventId: null, videoUrl: null, videoProvider: null },
    });
  });

  it("skips everything when the hiring calendar isn't linked", async () => {
    db.userCalendarLink.findFirst.mockResolvedValue(null);
    await provisionInterviewMeet("iv1");
    expect(db.interview.findUnique).not.toHaveBeenCalled();
    expect(db.userCalendarLink.update).not.toHaveBeenCalled();
  });
});
