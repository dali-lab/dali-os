import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "om-1", deduped: false })),
  drainNow: vi.fn(async () => {}),
}));
vi.mock("~/lib/gmail-integration", () => ({
  getApplicationsGmailRefreshToken: vi.fn(),
}));
vi.mock("~/hiring/lib/hiring-emails.server", () => ({
  getHiringEmail: vi.fn(),
}));
vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { getHiringEmail } from "~/hiring/lib/hiring-emails.server";
import { logAuditEvent } from "~/lib/audit";
import { countAnnouncementRecipients, sendEventAnnouncement } from "~/hiring/lib/hiring-event-notice";

const mockPrisma = prisma as unknown as {
  hiringEvent: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  application: { findMany: ReturnType<typeof vi.fn> };
};

const mockEnqueue = enqueueOutbound as unknown as ReturnType<typeof vi.fn>;

const EVENT_ID = "event-1";
const CYCLE_ID = "cycle-1";
const ACTOR_ID = "actor-1";

const EVENT = {
  id: EVENT_ID,
  applicationCycleId: CYCLE_ID,
  title: "Application help hour",
  startsAt: new Date("2026-10-14T20:00:00Z"),
  endsAt: new Date("2026-10-14T21:00:00Z"),
  location: "DALI Lab, Sudikoff",
};

const BINDING = {
  subject: "Join us: {{eventTitle}}",
  body: "Hi {{firstName}}, join us at {{time}} in {{location}}.",
};

function applicationRow(id: string, overrides: Partial<{ firstName: string; dartmouthEmail: string | null; netId: string | null }> = {}) {
  return {
    id,
    userId: `user-${id}`,
    user: {
      firstName: overrides.firstName ?? "Alex",
      dartmouthEmail: "dartmouthEmail" in overrides ? overrides.dartmouthEmail : `${id}@dartmouth.edu`,
      netId: "netId" in overrides ? overrides.netId : null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnqueue.mockResolvedValue({ id: "om-1", deduped: false });
  mockPrisma.hiringEvent.findUnique.mockResolvedValue(EVENT);
  mockPrisma.hiringEvent.update.mockResolvedValue({});
  mockPrisma.application.findMany.mockResolvedValue([]);
  vi.mocked(getApplicationsGmailRefreshToken).mockResolvedValue("refresh-token");
  vi.mocked(getHiringEmail).mockResolvedValue(BINDING);
});

describe("countAnnouncementRecipients", () => {
  it("counts the same recipients a send would reach", async () => {
    vi.mocked(prisma.application.findMany).mockResolvedValue([
      { id: "a1", user: { firstName: "Ada", dartmouthEmail: "ada@dartmouth.edu", netId: null } },
      { id: "a2", user: { firstName: "Bob", dartmouthEmail: null, netId: "f00" } },
      { id: "a3", user: { firstName: "Cy", dartmouthEmail: null, netId: null } },
    ] as never);
    expect(await countAnnouncementRecipients("cycle-1")).toBe(2);
    expect(vi.mocked(prisma.application.findMany).mock.calls[0][0]?.where).toMatchObject({
      applicationCycleId: "cycle-1",
      statusUpdates: { none: { newStatus: "Withdrawn" } },
      NOT: {
        domainApplications: {
          some: { selected: true, decisions: { some: { type: "Accepted", stage: "Released" } } },
        },
      },
    });
  });
});

describe("sendEventAnnouncement — not_configured", () => {
  it("is not_configured when the event doesn't exist", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue(null);
    const result = await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(result).toEqual({ outcome: "not_configured" });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("is not_configured when no gmail refresh token", async () => {
    vi.mocked(getApplicationsGmailRefreshToken).mockResolvedValue(null);
    const result = await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(result).toEqual({ outcome: "not_configured" });
    expect(getHiringEmail).not.toHaveBeenCalled();
  });

  it("is not_configured when no template is bound", async () => {
    vi.mocked(getHiringEmail).mockResolvedValue(null);
    const result = await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(result).toEqual({ outcome: "not_configured" });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("does not stamp announcementSentAt when not configured", async () => {
    vi.mocked(getHiringEmail).mockResolvedValue(null);
    await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(mockPrisma.hiringEvent.update).not.toHaveBeenCalled();
  });

  it("audits the not_configured outcome", async () => {
    vi.mocked(getHiringEmail).mockResolvedValue(null);
    await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "email.event_announcement",
        userId: ACTOR_ID,
        targetId: EVENT_ID,
        metadata: { outcome: "not_configured" },
      }),
    );
  });
});

describe("sendEventAnnouncement — recipient query", () => {
  it("excludes Withdrawn and hired applicants, includes everyone else (Submitted and Draft)", async () => {
    await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(mockPrisma.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          applicationCycleId: CYCLE_ID,
          domainApplications: { some: { selected: true } },
          statusUpdates: { none: { newStatus: "Withdrawn" } },
          NOT: {
            domainApplications: {
              some: { selected: true, decisions: { some: { type: "Accepted", stage: "Released" } } },
            },
          },
        },
      }),
    );
  });
});

describe("sendEventAnnouncement — sending", () => {
  it("sends one email per recipient with the rendered template", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1", { firstName: "Alex" })]);
    const result = await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(result).toEqual({ outcome: "sent", attempted: 1, succeeded: 1, failed: 0, alreadySent: 0 });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const call = mockEnqueue.mock.calls[0][0];
    expect(call.channel).toBe("email");
    expect(call.purpose).toBe("Hiring");
    expect(call.dedupKey).toBe("hiring.event_announce:event-1:a1");
    expect(call.target).toBe("a1@dartmouth.edu");
    expect(call.subject).toBe("Join us: Application help hour");
    expect(call.bodyHtml).toContain("Alex");
    expect(call.bodyHtml).toContain("DALI Lab, Sudikoff");
    expect(call.eventType).toBe("hiring.event_announcement");
  });

  it("attaches an ICS invite keyed to the event id", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1")]);
    await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    const call = mockEnqueue.mock.calls[0][0];
    expect(call.ics).toContain("UID:hiring-event-event-1@dali.dartmouth.edu");
    expect(call.ics).toContain("METHOD:REQUEST");
  });

  it("falls back to 'DALI Lab' when the event has no location", async () => {
    mockPrisma.hiringEvent.findUnique.mockResolvedValue({ ...EVENT, location: null });
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1")]);
    await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    const call = mockEnqueue.mock.calls[0][0];
    expect(call.bodyHtml).toContain("DALI Lab");
  });

  it("derives the recipient email from netId when dartmouthEmail is null", async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      applicationRow("a1", { dartmouthEmail: null, netId: "abc123" }),
    ]);
    await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(mockEnqueue.mock.calls[0][0].target).toBe("abc123@dartmouth.edu");
  });

  it("drains only the newly enqueued ids", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1"), applicationRow("a2")]);
    mockEnqueue
      .mockResolvedValueOnce({ id: "om-1", deduped: false })
      .mockResolvedValueOnce({ id: "om-2", deduped: false });
    await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(drainNow).toHaveBeenCalledWith(["om-1", "om-2"]);
  });

  it("counts a deduped enqueue as alreadySent and excludes it from drainNow", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1"), applicationRow("a2")]);
    mockEnqueue
      .mockResolvedValueOnce({ id: null, deduped: true })
      .mockResolvedValueOnce({ id: "om-2", deduped: false });
    const result = await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(result).toEqual({ outcome: "sent", attempted: 2, succeeded: 1, failed: 0, alreadySent: 1 });
    expect(drainNow).toHaveBeenCalledWith(["om-2"]);
  });

  it("stamps announcementSentAt on success", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1")]);
    await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(mockPrisma.hiringEvent.update).toHaveBeenCalledWith({
      where: { id: EVENT_ID },
      data: { announcementSentAt: expect.any(Date) },
    });
  });

  it("audits the sent outcome with the counts", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1")]);
    await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "email.event_announcement",
        userId: ACTOR_ID,
        targetId: EVENT_ID,
        metadata: { attempted: 1, succeeded: 1, failed: 0, alreadySent: 0 },
      }),
    );
  });

  it("counts a per-recipient failure without aborting the rest", async () => {
    mockPrisma.application.findMany.mockResolvedValue([applicationRow("a1"), applicationRow("a2")]);
    mockEnqueue
      .mockRejectedValueOnce(new Error("send failed"))
      .mockResolvedValueOnce({ id: "om-2", deduped: false });
    const result = await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(result).toEqual({ outcome: "sent", attempted: 2, succeeded: 1, failed: 1, alreadySent: 0 });
  });

  it("skips a recipient with no derivable email", async () => {
    mockPrisma.application.findMany.mockResolvedValue([
      applicationRow("a1", { dartmouthEmail: null, netId: null }),
    ]);
    const result = await sendEventAnnouncement(EVENT_ID, ACTOR_ID);
    expect(result).toEqual({ outcome: "sent", attempted: 0, succeeded: 0, failed: 0, alreadySent: 0 });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
