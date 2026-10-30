import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { getActiveInterviewerUserIds, notifyInterviewCancelled } from "~/hiring/lib/interview-notifications";

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.interview = {
    findUnique: vi.fn().mockResolvedValue({
      startTime: new Date("2026-11-04T22:00:00Z"),
      room: { name: "Pod A" },
      domainApplication: {
        domain: { name: "Fullstack Dev" },
        application: { user: { firstName: "Ada", lastName: "Byron" } },
      },
    }),
  };
  db.user = { findMany: vi.fn().mockResolvedValue([{ id: "u-grace", timeZone: "America/New_York" }]) };
});

const detail = () => vi.mocked(notify).mock.calls[0][0].recipients[0].vars?.itemDetail;

describe("getActiveInterviewerUserIds", () => {
  it("reads only Active assignments through the caller's transaction", async () => {
    const tx = {
      interviewAssignment: {
        findMany: vi.fn().mockResolvedValue([{ cycleInterviewer: { userId: "u-grace" } }]),
      },
    };
    expect(await getActiveInterviewerUserIds("iv1", tx as any)).toEqual(["u-grace"]);
    expect(tx.interviewAssignment.findMany.mock.calls[0][0].where).toEqual({
      interviewId: "iv1",
      status: "Active",
    });
  });
});

describe("notifyInterviewCancelled", () => {
  it.each([
    ["lead", "cancelled by the hiring lead"],
    ["applicant", "cancelled by the applicant"],
    ["moved", "moved to a new time by the applicant"],
  ] as const)("says why for reason %s", async (reason, text) => {
    await notifyInterviewCancelled({ interviewId: "iv1", interviewerUserIds: ["u-grace"], reason });
    expect(detail()).toContain(text);
    expect(detail()).toContain("Fullstack Dev");
    expect(detail()).toContain("Pod A");
  });

  it("names the applicant and links to the interview", async () => {
    await notifyInterviewCancelled({ interviewId: "iv1", interviewerUserIds: ["u-grace"], reason: "moved" });
    const args = vi.mocked(notify).mock.calls[0][0];
    expect(args.eventType).toBe("hiring.interview_cancelled");
    expect(args.recipients[0]).toMatchObject({
      userId: "u-grace",
      vars: { personName: "Ada Byron" },
      link: "/hiring/interviews/iv1",
    });
  });

  it("sends nothing when there were no interviewers", async () => {
    await notifyInterviewCancelled({ interviewId: "iv1", interviewerUserIds: [], reason: "applicant" });
    expect(notify).not.toHaveBeenCalled();
  });
});
