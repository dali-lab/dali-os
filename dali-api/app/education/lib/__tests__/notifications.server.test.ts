import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/education/lib/portal-email.server", () => ({ sendEducationEmail: vi.fn() }));
vi.mock("~/lib/email", () => ({
  renderEmail: vi.fn(),
  escapeHtml: (s: string) => s,
  htmlToPlainText: vi.fn(),
}));
vi.mock("~/email/lib/layout.server", () => ({ renderFramedEmail: vi.fn() }));
vi.mock("~/education/lib/education-emails.server", () => ({ getEducationEmail: vi.fn() }));
vi.mock("~/lib/outbound.server", () => ({ enqueueOutbound: vi.fn(), drainNow: vi.fn() }));
vi.mock("~/lib/app-env", () => ({ getFrontendUrl: () => "https://dali.test" }));

import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { sendEducationEmail } from "~/education/lib/portal-email.server";
import { renderEmail, htmlToPlainText } from "~/lib/email";
import { renderFramedEmail } from "~/email/lib/layout.server";
import { getEducationEmail } from "~/education/lib/education-emails.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import {
  recipientEmail,
  educationLink,
  notifyApplicationStatus,
  notifyNewAssignment,
  notifyGraded,
  notifySessionReminder,
  notifyExternalInstructorInvite,
} from "~/education/lib/notifications.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

const member = {
  id: "U-Ada",
  firstName: "Ada",
  daliEmail: "ada@dali.dartmouth.edu",
  dartmouthEmail: null,
  personalEmail: null,
  netId: null,
};
const portal = {
  id: "U-Grace",
  firstName: "Grace",
  daliEmail: null,
  dartmouthEmail: "grace@example.edu",
  personalEmail: null,
  netId: "f00grace",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(notify).mockResolvedValue(undefined as never);
  vi.mocked(sendEducationEmail).mockResolvedValue(undefined as never);
});
afterEach(() => vi.restoreAllMocks());

describe("recipientEmail", () => {
  const base = { id: "u", firstName: "A", daliEmail: null, dartmouthEmail: null, personalEmail: null, netId: null };
  it("prefers dali, then dartmouth, then personal, then netId@dartmouth.edu", () => {
    expect(recipientEmail({ ...base, daliEmail: "a@dali", dartmouthEmail: "b@d", personalEmail: "c@p", netId: "n" })).toBe("a@dali");
    expect(recipientEmail({ ...base, dartmouthEmail: "b@d", personalEmail: "c@p", netId: "n" })).toBe("b@d");
    expect(recipientEmail({ ...base, personalEmail: "c@p", netId: "n" })).toBe("c@p");
    expect(recipientEmail({ ...base, netId: "f00grace" })).toBe("f00grace@dartmouth.edu");
  });
  it("is null when the user has no address at all", () => {
    expect(recipientEmail(base)).toBeNull();
  });
});

describe("educationLink", () => {
  it("sends members to the member shell and everyone else to the portal mirror", () => {
    expect(educationLink({ daliEmail: "a@dali" }, "o1")).toBe("/education/o1");
    expect(educationLink({ daliEmail: null }, "o1")).toBe("/portal/education/o1");
  });
});

describe("notifyApplicationStatus", () => {
  function appRow(status: string, applicant: Record<string, unknown> = member) {
    mockPrisma.educationApplication.findUnique.mockResolvedValue({
      status,
      applicant,
      offering: { id: "off-1", title: "Design Basics" },
    });
  }

  beforeEach(() => {
    vi.mocked(getEducationEmail).mockResolvedValue(null as never);
  });

  it("does nothing when the application is missing", async () => {
    mockPrisma.educationApplication.findUnique.mockResolvedValue(null);
    await notifyApplicationStatus("app-1");
    expect(notify).not.toHaveBeenCalled();
  });

  it("does nothing for a still-Submitted application", async () => {
    appRow("Submitted");
    await notifyApplicationStatus("app-1");
    expect(notify).not.toHaveBeenCalled();
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it.each([
    ["Approved", "education.decision.approved"],
    ["Waitlisted", "education.decision.waitlisted"],
    ["Rejected", "education.decision.rejected"],
    ["Withdrawn", "education.decision.withdrawn"],
  ])("notifies only the applicant with the %s copy", async (status, copyKey) => {
    appRow(status);
    await notifyApplicationStatus("app-1");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      eventType: "education.decision",
      message: {
        copyKey,
        vars: { itemTitle: "Design Basics" },
        link: "/education/off-1",
      },
      recipients: [{ userId: "U-Ada" }],
    });
  });

  it("uses the promoted copy and links a portal applicant to the portal", async () => {
    appRow("Approved", portal);
    await notifyApplicationStatus("app-1", { promoted: true });
    const arg = vi.mocked(notify).mock.calls[0][0] as any;
    expect(arg.message.copyKey).toBe("education.decision.promoted");
    expect(arg.message.link).toBe("/portal/education/off-1");
  });

  it("still sends the decision email when the in-app write fails", async () => {
    appRow("Approved");
    vi.mocked(notify).mockRejectedValue(new Error("db down"));
    vi.mocked(getEducationEmail).mockResolvedValue({ subject: "s", body: "b" } as never);
    vi.mocked(renderEmail).mockReturnValue({ subject: "Hi", html: "<p>x</p>" } as never);
    vi.mocked(htmlToPlainText).mockReturnValue("x");
    vi.mocked(renderFramedEmail).mockResolvedValue({ subject: "Hi", html: "<p>f</p>", text: "f" } as never);
    vi.mocked(enqueueOutbound).mockResolvedValue({ id: "ob-1" } as never);
    await notifyApplicationStatus("app-1");
    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
  });

  describe("decision email", () => {
    beforeEach(() => {
      vi.mocked(getEducationEmail).mockResolvedValue({ subject: "s", body: "b" } as never);
      vi.mocked(renderEmail).mockReturnValue({ subject: "Welcome", html: "<p>x</p>" } as never);
      vi.mocked(htmlToPlainText).mockReturnValue("x");
      vi.mocked(renderFramedEmail).mockResolvedValue({ subject: "Welcome", html: "<p>f</p>", text: "f" } as never);
      vi.mocked(enqueueOutbound).mockResolvedValue({ id: "ob-1" } as never);
    });

    it("enqueues a transactional email keyed by outcome and drains it", async () => {
      appRow("Waitlisted");
      await notifyApplicationStatus("app-1");
      expect(getEducationEmail).toHaveBeenCalledWith("decision:Waitlisted");
      expect(renderEmail).toHaveBeenCalledWith(
        { subject: "s", body: "b" },
        { firstName: "Ada", domain: "Design Basics" },
      );
      expect(enqueueOutbound).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "email",
          purpose: "Education",
          dedupKey: "education.decision:app-1:Waitlisted:u-ada",
          target: "ada@dali.dartmouth.edu",
          recipientUserId: "U-Ada",
          subject: "Welcome",
          bodyHtml: "<p>f</p>",
          bodyText: "f",
          eventType: "education.decision",
        }),
      );
      expect(drainNow).toHaveBeenCalledWith(["ob-1"]);
    });

    it("keys a promotion differently from a plain approval and prefers the Promoted slot", async () => {
      appRow("Approved");
      await notifyApplicationStatus("app-1", { promoted: true });
      expect(getEducationEmail).toHaveBeenNthCalledWith(1, "decision:Promoted");
      expect(vi.mocked(enqueueOutbound).mock.calls[0][0].dedupKey).toBe(
        "education.decision:app-1:promoted:u-ada",
      );
    });

    it("falls back to the Approved letter when no Promoted copy is written", async () => {
      appRow("Approved");
      vi.mocked(getEducationEmail).mockImplementation(async (slot: string) =>
        slot === "decision:Promoted" ? null : ({ subject: "s", body: "b" } as never),
      );
      await notifyApplicationStatus("app-1", { promoted: true });
      expect(getEducationEmail).toHaveBeenCalledWith("decision:Approved");
      expect(enqueueOutbound).toHaveBeenCalledTimes(1);
    });

    it("sends no email when the slot has none written", async () => {
      appRow("Rejected");
      vi.mocked(getEducationEmail).mockResolvedValue(null as never);
      await notifyApplicationStatus("app-1");
      expect(enqueueOutbound).not.toHaveBeenCalled();
    });

    it("sends no email when the applicant has no address", async () => {
      appRow("Approved", { ...member, daliEmail: null, netId: null } as never);
      await notifyApplicationStatus("app-1");
      expect(enqueueOutbound).not.toHaveBeenCalled();
    });

    it("swallows email failures", async () => {
      appRow("Approved");
      vi.mocked(enqueueOutbound).mockRejectedValue(new Error("boom"));
      await expect(notifyApplicationStatus("app-1")).resolves.toBeUndefined();
    });
  });
});

describe("notifyNewAssignment", () => {
  const args = {
    offeringId: "off-1",
    assignmentId: "as-1",
    assignmentTitle: "Wireframes",
    dueAt: null as Date | null,
  };

  it("does nothing when the offering is gone", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue(null);
    await notifyNewAssignment(args);
    expect(mockPrisma.educationApplication.findMany).not.toHaveBeenCalled();
  });

  it("does nothing when nobody is enrolled", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({ id: "off-1", title: "Design Basics" });
    mockPrisma.educationApplication.findMany.mockResolvedValue([]);
    await notifyNewAssignment(args);
    expect(notify).not.toHaveBeenCalled();
    expect(sendEducationEmail).not.toHaveBeenCalled();
  });

  it("queries only Approved enrollees of the offering", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({ id: "off-1", title: "Design Basics" });
    mockPrisma.educationApplication.findMany.mockResolvedValue([]);
    await notifyNewAssignment(args);
    expect(mockPrisma.educationApplication.findMany.mock.calls[0][0].where).toEqual({
      offeringId: "off-1",
      status: "Approved",
    });
  });

  it("notifies members and portal students through one notify(), each on their own surface", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({ id: "off-1", title: "Design Basics" });
    mockPrisma.educationApplication.findMany.mockResolvedValue([
      { applicant: member },
      { applicant: portal },
    ]);
    await notifyNewAssignment({ ...args, dueAt: new Date("2026-10-15T03:59:00Z") });

    expect(notify).toHaveBeenCalledTimes(1);
    const n = vi.mocked(notify).mock.calls[0][0] as any;
    expect(n.eventType).toBe("education.assignment");
    expect(n.recipients).toEqual([
      { userId: "U-Ada", link: "/education/off-1/assignments/as-1" },
      { userId: "U-Grace", link: "/portal/education/off-1/assignments/as-1" },
    ]);
    expect(n.message.vars).toEqual({
      itemTitle: "Wireframes",
      contextName: "Design Basics",
      // 03:59Z on Oct 15 is 11:59 PM ET on Oct 14.
      itemDetail: "Due Oct 14. Open the course hub to submit.",
    });
    expect(n.message.linkLabel).toBe("Open the assignment");
    expect(n.message.dedupKey).toBe("education.assignment:as-1");
    expect(sendEducationEmail).not.toHaveBeenCalled();
  });

  it("omits the due date when there is none", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({ id: "off-1", title: "Design Basics" });
    mockPrisma.educationApplication.findMany.mockResolvedValue([{ applicant: member }]);
    await notifyNewAssignment(args);
    expect((vi.mocked(notify).mock.calls[0][0] as any).message.vars.itemDetail).toBe(
      "Open the course hub to submit.",
    );
  });

  it("does not throw when the in-app dispatch fails", async () => {
    mockPrisma.educationOffering.findUnique.mockResolvedValue({ id: "off-1", title: "Design Basics" });
    mockPrisma.educationApplication.findMany.mockResolvedValue([{ applicant: member }]);
    vi.mocked(notify).mockRejectedValue(new Error("x"));
    await expect(notifyNewAssignment(args)).resolves.toBeUndefined();
  });
});

describe("notifyGraded", () => {
  const args = { studentId: "U-Ada", offeringId: "off-1", assignmentId: "as-1", assignmentTitle: "Wireframes" };

  it("does nothing for an unknown student", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await notifyGraded(args);
    expect(notify).not.toHaveBeenCalled();
    expect(sendEducationEmail).not.toHaveBeenCalled();
  });

  it("notifies a member with a member-shell deep link", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(member);
    await notifyGraded(args);
    expect(notify).toHaveBeenCalledWith({
      eventType: "education.grade",
      message: { vars: { itemTitle: "Wireframes" }, linkLabel: "Open the assignment" },
      recipients: [{ userId: "U-Ada", link: "/education/off-1/assignments/as-1" }],
    });
  });

  it("notifies a portal student through notify() with a portal deep link", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(portal);
    await notifyGraded(args);
    expect(sendEducationEmail).not.toHaveBeenCalled();
    expect((vi.mocked(notify).mock.calls[0][0] as any).recipients).toEqual([
      { userId: "U-Grace", link: "/portal/education/off-1/assignments/as-1" },
    ]);
  });

  it("swallows dispatch failures", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(member);
    vi.mocked(notify).mockRejectedValue(new Error("x"));
    await expect(notifyGraded(args)).resolves.toBeUndefined();
  });
});

describe("notifySessionReminder", () => {
  const args = {
    sessionId: "s-1",
    offeringId: "off-1",
    offeringTitle: "Design Basics",
    sequence: 2,
    sessionTitle: null as string | null,
    // 18:30Z on Oct 14 2026 is 2:30 PM EDT.
    datetime: new Date("2026-10-14T18:30:00Z"),
    location: null as string | null,
  };

  it("does nothing when nobody is enrolled", async () => {
    mockPrisma.educationApplication.findMany.mockResolvedValue([]);
    await notifySessionReminder(args);
    expect(notify).not.toHaveBeenCalled();
  });

  it("only reaches Approved enrollees of that offering", async () => {
    mockPrisma.educationApplication.findMany.mockResolvedValue([]);
    await notifySessionReminder(args);
    expect(mockPrisma.educationApplication.findMany.mock.calls[0][0].where).toEqual({
      offeringId: "off-1",
      status: "Approved",
    });
  });

  it("falls back to 'Session N', labels the time ET, and reaches every enrollee on their surface", async () => {
    mockPrisma.educationApplication.findMany.mockResolvedValue([
      { applicant: member },
      { applicant: portal },
    ]);
    await notifySessionReminder(args);

    expect(notify).toHaveBeenCalledTimes(1);
    const n = vi.mocked(notify).mock.calls[0][0] as any;
    expect(n.eventType).toBe("education.session_reminder");
    expect(n.recipients).toEqual([
      { userId: "U-Ada", link: "/education/off-1/hub" },
      { userId: "U-Grace", link: "/portal/education/off-1/hub" },
    ]);
    expect(n.message.vars.itemTitle).toBe("Session 2");
    expect(n.message.vars.contextName).toBe("Design Basics");
    expect(n.message.vars.when).toBe("Wednesday, Oct 14, 2:30 PM (ET)");
    expect(n.message.vars.itemDetail).toBe("");
    expect(n.message.linkLabel).toBe("Open the course hub");
    expect(n.message.dedupKey).toBe("education.session_reminder:s-1");
    expect(sendEducationEmail).not.toHaveBeenCalled();
  });

  it("uses the session title and appends the location", async () => {
    mockPrisma.educationApplication.findMany.mockResolvedValue([{ applicant: member }]);
    await notifySessionReminder({ ...args, sessionTitle: "Critique", location: "Room 101" });
    const n = vi.mocked(notify).mock.calls[0][0] as any;
    expect(n.message.vars.itemTitle).toBe("Critique");
    expect(n.message.vars.itemDetail).toBe(" · Room 101");
  });

  it("does not throw when notify() fails", async () => {
    mockPrisma.educationApplication.findMany.mockResolvedValue([{ applicant: member }]);
    vi.mocked(notify).mockRejectedValue(new Error("x"));
    await expect(notifySessionReminder(args)).resolves.toBeUndefined();
  });
});

describe("notifyExternalInstructorInvite", () => {
  const base = { offeringId: "off-1", offeringTitle: "Design Basics" };

  it("emails the Dartmouth address with a teaching-dashboard link", async () => {
    await notifyExternalInstructorInvite({
      ...base,
      user: { id: "U-Grace", firstName: "Grace", dartmouthEmail: "grace@example.edu", netId: "f00grace" },
    });
    expect(sendEducationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "grace@example.edu",
        recipientUserId: "U-Grace",
        dedupKey: "education.instructor-invite:off-1:u-grace",
        subject: "You're an instructor for Design Basics",
        cta: { path: "/education/manage/off-1", label: "Open your teaching dashboard" },
      }),
    );
  });

  it("falls back to netId@dartmouth.edu", async () => {
    await notifyExternalInstructorInvite({
      ...base,
      user: { id: "U-Grace", firstName: "Grace", dartmouthEmail: null, netId: "f00grace" },
    });
    expect(vi.mocked(sendEducationEmail).mock.calls[0][0].to).toBe("f00grace@dartmouth.edu");
  });

  it("sends nothing without any address, and swallows send failures", async () => {
    await notifyExternalInstructorInvite({
      ...base,
      user: { id: "U-Grace", firstName: "Grace", dartmouthEmail: null, netId: null },
    });
    expect(sendEducationEmail).not.toHaveBeenCalled();

    vi.mocked(sendEducationEmail).mockRejectedValue(new Error("x"));
    await expect(
      notifyExternalInstructorInvite({
        ...base,
        user: { id: "U-Grace", firstName: "Grace", dartmouthEmail: "g@example.edu", netId: null },
      }),
    ).resolves.toBeUndefined();
  });
});
