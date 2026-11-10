import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async (msg: { target: string }) => ({ id: `out-${msg.target}` })),
  drainNow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/hiring/lib/hiring-emails.server", () => ({
  getHiringEmail: vi.fn().mockResolvedValue({ subject: "s", body: "b" }),
}));
vi.mock("~/hiring/lib/email-variables", () => ({
  notificationSlot: (type: string) => type,
  renderForSlot: vi.fn(() => ({ subject: "Cancelled", html: "<p>Cancelled</p>" })),
}));
vi.mock("~/hiring/lib/interview-meet", () => ({ ensureInterviewMeetUrl: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getInterviewerRecipients, sendInterviewCancelEmails } from "~/hiring/lib/interview-emails";

const db = prisma as any;

const interview = {
  id: "iv1",
  startTime: new Date("2026-11-04T22:00:00Z"),
  endTime: new Date("2026-11-04T22:30:00Z"),
  room: null,
  roomId: null,
  videoUrl: null,
  zoomJoinUrl: null,
};
const ada = { email: "ada@example.edu", firstName: "Ada" };
const grace = { email: "grace@example.edu", firstName: "Grace" };

const sentTo = () => vi.mocked(enqueueOutbound).mock.calls.map(([msg]) => msg.target);
const sentMessage = (target: string) =>
  vi.mocked(enqueueOutbound).mock.calls.map(([msg]) => msg).find((msg) => msg.target === target);

beforeEach(() => {
  vi.clearAllMocks();
  db.interview = {
    findUnique: vi.fn().mockResolvedValue(interview),
    update: vi.fn().mockResolvedValue({ icsSequence: 1 }),
  };
  db.domainApplication = {
    findUnique: vi.fn().mockImplementation(({ include }: any) =>
      Promise.resolve(
        include?.domain
          ? { domain: { name: "Fullstack Dev" } }
          : { application: { user: { firstName: "Lin", dartmouthEmail: "lin@example.edu" } } },
      ),
    ),
  };
  // Mirrors the database after a cancel: every assignment is already Declined.
  db.interviewAssignment = { findMany: vi.fn().mockResolvedValue([]) };
});

describe("sendInterviewCancelEmails", () => {
  it("sends the cancellation to the interviewers it was given after their assignments are declined", async () => {
    await sendInterviewCancelEmails("iv1", "da1", [ada, grace]);

    expect(sentTo()).toEqual(["lin@example.edu", "ada@example.edu", "grace@example.edu"]);
    expect(db.interviewAssignment.findMany).not.toHaveBeenCalled();
    expect(drainNow).toHaveBeenCalledWith(["out-lin@example.edu", "out-ada@example.edu", "out-grace@example.edu"]);
  });

  it("attaches a calendar cancel naming every interviewer so the event drops off their calendars", async () => {
    await sendInterviewCancelEmails("iv1", "da1", [ada, grace]);

    const ics = sentMessage("ada@example.edu")?.ics;
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("iv1");
    expect(ics).toContain("ada@example.edu");
    expect(ics).toContain("grace@example.edu");
    expect(sentMessage("ada@example.edu")).toMatchObject({
      eventType: "hiring.interview.cancel",
      dedupKey: "hiring.interview.cancel:iv1:ada@example.edu",
    });
  });

  it("still tells the interviewers when the applicant email is skipped", async () => {
    await sendInterviewCancelEmails("iv1", "da1", [ada], { skipApplicant: true });

    expect(sentTo()).toEqual(["ada@example.edu"]);
  });

  it("sends only to the applicant when there were no interviewers", async () => {
    await sendInterviewCancelEmails("iv1", "da1", []);

    expect(sentTo()).toEqual(["lin@example.edu"]);
  });
});

describe("getInterviewerRecipients", () => {
  const assignment = (firstName: string, daliEmail: string | null) => ({
    cycleInterviewer: { user: { firstName, daliEmail } },
  });

  it("reads only Active assignments, so interviewers reassigned off earlier are left out", async () => {
    db.interviewAssignment.findMany.mockResolvedValue([assignment("Ada", "ada@example.edu")]);

    await expect(getInterviewerRecipients("iv1")).resolves.toEqual([ada]);
    expect(db.interviewAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { interviewId: "iv1", status: "Active" } }),
    );
  });

  it("reads through the caller's transaction when given one", async () => {
    const tx: any = { interviewAssignment: { findMany: vi.fn().mockResolvedValue([assignment("Ada", "ada@example.edu")]) } };

    await expect(getInterviewerRecipients("iv1", tx)).resolves.toEqual([ada]);
    expect(tx.interviewAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(db.interviewAssignment.findMany).not.toHaveBeenCalled();
  });

  it("skips interviewers with no DALI email", async () => {
    db.interviewAssignment.findMany.mockResolvedValue([
      assignment("Ada", "ada@example.edu"),
      assignment("Grace", null),
    ]);

    await expect(getInterviewerRecipients("iv1")).resolves.toEqual([ada]);
  });
});
