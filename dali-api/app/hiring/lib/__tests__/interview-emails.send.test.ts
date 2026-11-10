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
  renderForSlot: vi.fn((slot: string, _email: unknown, vars: Record<string, string>) => ({
    subject: `${slot}|${vars.firstName}|${vars.location}`,
    html: "<p>body</p>",
  })),
}));
vi.mock("~/hiring/lib/interview-meet", () => ({
  ensureInterviewMeetUrl: vi.fn(async () => "https://meet.example.edu/abc"),
}));

import { prisma } from "~/lib/db.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getHiringEmail } from "~/hiring/lib/hiring-emails.server";
import {
  sendInterviewInviteEmails,
  sendInterviewReminderEmails,
  sendLocationChangeEmails,
} from "~/hiring/lib/interview-emails";

const db = prisma as any;

const baseInterview = {
  id: "iv1",
  status: "Scheduled",
  domainApplicationId: "da1",
  startTime: new Date("2026-11-04T22:00:00Z"),
  endTime: new Date("2026-11-04T22:30:00Z"),
  room: null,
  roomId: null,
  calendarEventId: "evt1",
  videoUrl: null,
  zoomJoinUrl: null,
  icsSequence: 0,
};

const assignment = (firstName: string, daliEmail: string | null) => ({
  cycleInterviewer: { user: { firstName, daliEmail } },
});

const msgs = () => vi.mocked(enqueueOutbound).mock.calls.map(([m]) => m as any);
const msgTo = (target: string) => msgs().find((m) => m.target === target);

function mockApplicant(user: { firstName: string; dartmouthEmail: string | null; netId: string | null } | null) {
  db.domainApplication.findUnique.mockImplementation(({ include }: any) =>
    Promise.resolve(include?.domain ? { domain: { name: "Fullstack Dev" } } : user ? { application: { user } } : null),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHiringEmail).mockImplementation((async (slot: string) => ({ subject: slot, body: "b" })) as any);
  db.interview = {
    findUnique: vi.fn().mockResolvedValue(baseInterview),
    update: vi.fn().mockResolvedValue({ icsSequence: 3 }),
  };
  db.domainApplication = { findUnique: vi.fn() };
  mockApplicant({ firstName: "Lin", dartmouthEmail: "Lin@example.edu", netId: null });
  db.interviewAssignment = {
    findMany: vi.fn().mockResolvedValue([assignment("Ada", "ada@example.edu"), assignment("Grace", "grace@example.edu")]),
  };
});

describe("sendInterviewInviteEmails", () => {
  it("sends the applicant a confirmation and each interviewer a mentor invite", async () => {
    await sendInterviewInviteEmails("iv1", "da1");

    expect(msgs().map((m) => [m.target, m.subject.split("|")[0]])).toEqual([
      ["Lin@example.edu", "InterviewConfirmedApplicant"],
      ["ada@example.edu", "InterviewInviteMentor"],
      ["grace@example.edu", "InterviewInviteMentor"],
    ]);
    expect(drainNow).toHaveBeenCalledWith(["out-Lin@example.edu", "out-ada@example.edu", "out-grace@example.edu"]);
  });

  it("dedups per recipient with a lowercased key on the first send", async () => {
    await sendInterviewInviteEmails("iv1", "da1");

    expect(msgTo("Lin@example.edu").dedupKey).toBe("hiring.interview.invite:iv1:lin@example.edu");
    expect(msgTo("ada@example.edu").dedupKey).toBe("hiring.interview.invite:iv1:ada@example.edu");
  });

  it("drops the dedup key on an intentional resend", async () => {
    await sendInterviewInviteEmails("iv1", "da1", { dedupKey: null });

    expect(msgs().map((m) => m.dedupKey)).toEqual([null, null, null]);
  });

  it("lists only the applicant as a guest on the applicant's calendar event, everyone on the interviewers'", async () => {
    await sendInterviewInviteEmails("iv1", "da1");

    const applicantIcs: string = msgTo("Lin@example.edu").ics;
    expect(applicantIcs).toContain("METHOD:REQUEST");
    expect(applicantIcs).toContain("Lin@example.edu");
    expect(applicantIcs).not.toContain("ada@example.edu");
    const interviewerIcs: string = msgTo("ada@example.edu").ics;
    expect(interviewerIcs).toContain("Lin@example.edu");
    expect(interviewerIcs).toContain("ada@example.edu");
    expect(interviewerIcs).toContain("grace@example.edu");
  });

  it("does not bump the calendar sequence for the first invite", async () => {
    await sendInterviewInviteEmails("iv1", "da1");

    expect(db.interview.update).not.toHaveBeenCalled();
  });

  it("carries the freshly minted Meet link to online interviews", async () => {
    await sendInterviewInviteEmails("iv1", "da1");

    expect(msgTo("Lin@example.edu").subject).toContain("Online: https://meet.example.edu/abc");
  });

  it("falls back to the applicant's netId address when they have no dartmouth email", async () => {
    mockApplicant({ firstName: "Lin", dartmouthEmail: null, netId: "f00abcd" });

    await sendInterviewInviteEmails("iv1", "da1");

    expect(msgs().map((m) => m.target)).toContain("f00abcd@dartmouth.edu");
  });

  it("skips interviewers with no DALI email", async () => {
    db.interviewAssignment.findMany.mockResolvedValue([assignment("Ada", null), assignment("Grace", "grace@example.edu")]);

    await sendInterviewInviteEmails("iv1", "da1");

    expect(msgs().map((m) => m.target)).toEqual(["Lin@example.edu", "grace@example.edu"]);
  });

  it("sends nothing to an audience whose email has not been written", async () => {
    vi.mocked(getHiringEmail).mockImplementation((async (slot: string) =>
      slot === "InterviewConfirmedApplicant" ? null : { subject: slot, body: "b" }) as any);

    await sendInterviewInviteEmails("iv1", "da1");

    expect(msgs().map((m) => m.target)).toEqual(["ada@example.edu", "grace@example.edu"]);
  });

  it("sends nothing when the interview is gone", async () => {
    db.interview.findUnique.mockResolvedValue(null);

    await sendInterviewInviteEmails("iv1", "da1");

    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("never throws into the booking flow", async () => {
    db.interview.findUnique.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendInterviewInviteEmails("iv1", "da1")).resolves.toBeUndefined();
  });
});

describe("sendInterviewReminderEmails", () => {
  it("sends the applicant and interviewers their own reminder slot and returns the count", async () => {
    const count = await sendInterviewReminderEmails("iv1");

    expect(count).toBe(3);
    expect(msgs().map((m) => [m.target, m.subject.split("|")[0]])).toEqual([
      ["Lin@example.edu", "InterviewReminderApplicant"],
      ["ada@example.edu", "InterviewReminderInterviewer"],
      ["grace@example.edu", "InterviewReminderInterviewer"],
    ]);
  });

  it("sends no calendar attachment and no dedup key, since the job's ledger row is the guard", async () => {
    await sendInterviewReminderEmails("iv1");

    for (const m of msgs()) {
      expect(m.ics).toBeUndefined();
      expect(m.dedupKey).toBeUndefined();
      expect(m.eventType).toBe("hiring.interview.reminder");
    }
  });

  it.each(["Completed", "CancelledByApplicant", "CancelledByAdmin"])(
    "sends nothing if the interview became %s after the job claimed it",
    async (status) => {
      db.interview.findUnique.mockResolvedValue({ ...baseInterview, status });

      expect(await sendInterviewReminderEmails("iv1")).toBe(0);
      expect(enqueueOutbound).not.toHaveBeenCalled();
    },
  );

  it("returns 0 when the interview does not exist", async () => {
    db.interview.findUnique.mockResolvedValue(null);

    expect(await sendInterviewReminderEmails("iv1")).toBe(0);
  });

  it("only counts audiences whose email exists", async () => {
    vi.mocked(getHiringEmail).mockImplementation((async (slot: string) =>
      slot === "InterviewReminderInterviewer" ? null : { subject: slot, body: "b" }) as any);

    expect(await sendInterviewReminderEmails("iv1")).toBe(1);
    expect(msgs().map((m) => m.target)).toEqual(["Lin@example.edu"]);
  });

  it("returns 0 instead of throwing when a lookup fails", async () => {
    db.interview.findUnique.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sendInterviewReminderEmails("iv1")).toBe(0);
  });
});

describe("sendLocationChangeEmails", () => {
  it("emails the applicant and every interviewer the location-changed slot, with no dedup key", async () => {
    await sendLocationChangeEmails("iv1", "da1");

    expect(msgs().map((m) => [m.target, m.subject.split("|")[0], m.dedupKey, m.eventType])).toEqual([
      ["Lin@example.edu", "InterviewLocationChanged", undefined, "hiring.interview.location"],
      ["ada@example.edu", "InterviewLocationChanged", undefined, "hiring.interview.location"],
      ["grace@example.edu", "InterviewLocationChanged", undefined, "hiring.interview.location"],
    ]);
  });

  it("bumps the calendar sequence and sends it on every update so calendars apply the change", async () => {
    await sendLocationChangeEmails("iv1", "da1");

    expect(db.interview.update).toHaveBeenCalledWith({
      where: { id: "iv1" },
      data: { icsSequence: { increment: 1 } },
      select: { icsSequence: true },
    });
    for (const m of msgs()) expect(m.ics).toContain("SEQUENCE:3");
  });

  it("keeps the applicant's calendar guest list to themselves", async () => {
    await sendLocationChangeEmails("iv1", "da1");

    expect(msgTo("Lin@example.edu").ics).not.toContain("ada@example.edu");
    expect(msgTo("ada@example.edu").ics).toContain("Lin@example.edu");
  });

  it("sends nothing when the interview is gone", async () => {
    db.interview.findUnique.mockResolvedValue(null);

    await sendLocationChangeEmails("iv1", "da1");

    expect(enqueueOutbound).not.toHaveBeenCalled();
    expect(db.interview.update).not.toHaveBeenCalled();
  });
});
