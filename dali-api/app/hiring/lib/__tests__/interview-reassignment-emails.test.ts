import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async (msg: { target: string }) => ({ id: `out-${msg.target}` })),
  drainNow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/hiring/lib/hiring-emails.server", () => ({
  getHiringEmail: vi.fn(async (slot: string) => ({ subject: slot, body: "b" })),
}));
vi.mock("~/hiring/lib/email-variables", () => ({
  notificationSlot: (type: string) => type,
  renderForSlot: vi.fn((slot: string) => ({ subject: slot, html: "<p>body</p>" })),
}));
vi.mock("~/hiring/lib/interview-meet", () => ({ ensureInterviewMeetUrl: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { enqueueOutbound } from "~/lib/outbound.server";
import { getHiringEmail } from "~/hiring/lib/hiring-emails.server";
import { sendReassignmentEmails } from "~/hiring/lib/interview-emails";

const db = prisma as any;

const interviewer = (firstName: string, email: string) => ({
  cycleInterviewer: { user: { firstName, daliEmail: email } },
});

const sent = (target: string) =>
  vi.mocked(enqueueOutbound).mock.calls.map(([msg]) => msg).find((msg) => msg.target === target);

beforeEach(() => {
  vi.clearAllMocks();
  db.interview = {
    findUnique: vi.fn().mockResolvedValue({
      id: "iv1",
      startTime: new Date("2026-11-04T22:00:00Z"),
      endTime: new Date("2026-11-04T22:30:00Z"),
      room: null,
      roomId: null,
      videoUrl: null,
      zoomJoinUrl: null,
    }),
    update: vi.fn().mockResolvedValue({ icsSequence: 2 }),
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
  db.cycleInterviewer = {
    findUnique: vi.fn().mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.id === "removed"
          ? { user: { firstName: "Ada", daliEmail: "ada@example.edu" } }
          : { user: { firstName: "Mary", daliEmail: "mary@example.edu" } },
      ),
    ),
  };
  db.interviewAssignment = {
    findMany: vi.fn().mockResolvedValue([
      interviewer("Grace", "grace@example.edu"),
      interviewer("Mary", "mary@example.edu"),
    ]),
  };
});

describe("sendReassignmentEmails", () => {
  it("sends the removed interviewer a cancellation with a calendar cancel", async () => {
    await sendReassignmentEmails("iv1", "da1", "removed", "added");
    const msg = sent("ada@example.edu");
    expect(msg?.subject).toBe("InterviewCancelledInterviewer");
    expect(msg?.ics).toContain("METHOD:CANCEL");
  });

  it("sends the new interviewer an invite", async () => {
    await sendReassignmentEmails("iv1", "da1", "removed", "added");
    const msg = sent("mary@example.edu");
    expect(msg?.subject).toBe("InterviewInviteMentor");
    expect(msg?.ics).toContain("METHOD:REQUEST");
  });

  it("tells the interviewer who stays that the other one changed, with the calendar update", async () => {
    await sendReassignmentEmails("iv1", "da1", "removed", "added");
    const msg = sent("grace@example.edu");
    expect(msg?.subject).toBe("InterviewInterviewerChanged");
    expect(msg?.ics).toContain("METHOD:REQUEST");
  });

  it("sends the applicant nothing", async () => {
    await sendReassignmentEmails("iv1", "da1", "removed", "added");
    expect(sent("lin@example.edu")).toBeUndefined();
    expect(vi.mocked(getHiringEmail)).not.toHaveBeenCalledWith("InterviewConfirmedApplicant");
  });

  it("emails only the removed, remaining, and new interviewers", async () => {
    await sendReassignmentEmails("iv1", "da1", "removed", "added");
    const targets = vi.mocked(enqueueOutbound).mock.calls.map(([msg]) => msg.target).sort();
    expect(targets).toEqual(["ada@example.edu", "grace@example.edu", "mary@example.edu"]);
  });

  it("keeps the applicant on the interviewers' calendar guest list and drops the removed interviewer", async () => {
    await sendReassignmentEmails("iv1", "da1", "removed", "added");
    const ics = sent("grace@example.edu")?.ics ?? "";
    expect(ics).toContain("lin@example.edu");
    expect(ics).toContain("grace@example.edu");
    expect(ics).toContain("mary@example.edu");
    expect(ics).not.toContain("ada@example.edu");
  });

  it("gives the cancel and the update the same bumped calendar sequence", async () => {
    await sendReassignmentEmails("iv1", "da1", "removed", "added");
    expect(db.interview.update).toHaveBeenCalledTimes(1);
    expect(sent("ada@example.edu")?.ics).toContain("SEQUENCE:2");
    expect(sent("grace@example.edu")?.ics).toContain("SEQUENCE:2");
  });

  it("still updates the interviewers when the applicant has no email", async () => {
    db.domainApplication.findUnique.mockImplementation(({ include }: any) =>
      Promise.resolve(
        include?.domain
          ? { domain: { name: "Fullstack Dev" } }
          : { application: { user: { firstName: "Lin", dartmouthEmail: null, netId: null } } },
      ),
    );
    await sendReassignmentEmails("iv1", "da1", "removed", "added");
    const ics = sent("grace@example.edu")?.ics ?? "";
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).not.toContain("lin@example.edu");
  });

  it("falls back to the invite so the calendar update still goes out when the email isn't written", async () => {
    vi.mocked(getHiringEmail).mockImplementation(async (slot: any) =>
      slot === "InterviewInterviewerChanged" ? null : ({ subject: slot, body: "b" } as any),
    );
    await sendReassignmentEmails("iv1", "da1", "removed", "added");
    const msg = sent("grace@example.edu");
    expect(msg?.subject).toBe("InterviewInviteMentor");
    expect(msg?.ics).toContain("METHOD:REQUEST");
  });
});
