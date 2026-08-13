import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/gmail", () => ({ sendEmail: vi.fn() }));
vi.mock("~/lib/gmail-integration", () => ({
  getSender: vi.fn(),
  noteSenderHealth: vi.fn(),
}));
vi.mock("~/lib/app-env", () => ({
  getFrontendUrl: vi.fn(() => "https://os.dali.dartmouth.edu"),
}));

import { prisma } from "~/lib/db";
import { sendEmail } from "~/lib/gmail";
import { getSender } from "~/lib/gmail-integration";
import {
  shouldRunDigest,
  runDigest,
  renderDigestEmail,
} from "~/lib/notification-digest.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockSendEmail = sendEmail as unknown as ReturnType<typeof vi.fn>;
const mockGetSender = getSender as unknown as ReturnType<typeof vi.fn>;

// July 2026 is EDT (UTC-4): 9am ET = 13:00 UTC. 2026-07-15 is a Wednesday;
// 2026-07-13 is a Monday.
const WED_0859_ET = new Date("2026-07-15T12:59:00Z");
const WED_0901_ET = new Date("2026-07-15T13:01:00Z");
const MON_0901_ET = new Date("2026-07-13T13:01:00Z");

describe("shouldRunDigest", () => {
  const AT_9 = { sendHourEt: 9 };

  it("waits for the configured ET hour", () => {
    expect(shouldRunDigest("Daily", null, WED_0859_ET, AT_9)).toBe(false);
    expect(shouldRunDigest("Daily", null, WED_0901_ET, AT_9)).toBe(true);
    // Reconfigured to 2pm ET (18:00 UTC in July): 9:01 is no longer due.
    expect(shouldRunDigest("Daily", null, WED_0901_ET, { sendHourEt: 14 })).toBe(false);
    expect(
      shouldRunDigest("Daily", null, new Date("2026-07-15T18:01:00Z"), { sendHourEt: 14 }),
    ).toBe(true);
  });

  it("suppresses a second send the same day", () => {
    const sentAt0902 = new Date("2026-07-15T13:02:00Z");
    const later = new Date("2026-07-15T18:00:00Z");
    expect(shouldRunDigest("Daily", sentAt0902, later, AT_9)).toBe(false);
  });

  it("a pre-9am success (the not-due tick) does not suppress today's send", () => {
    const notDueRun = new Date("2026-07-15T12:45:00Z");
    expect(shouldRunDigest("Daily", notDueRun, WED_0901_ET, AT_9)).toBe(true);
  });

  it("weekly fires only on the configured ET weekday", () => {
    const MON = { sendHourEt: 9, sendWeekday: 1 };
    expect(shouldRunDigest("Weekly", null, WED_0901_ET, MON)).toBe(false);
    expect(shouldRunDigest("Weekly", null, MON_0901_ET, MON)).toBe(true);
    const lastMonday = new Date("2026-07-06T13:05:00Z");
    expect(shouldRunDigest("Weekly", lastMonday, MON_0901_ET, MON)).toBe(true);
    // Reconfigured to Wednesday: Monday no longer fires, Wednesday does.
    const WED = { sendHourEt: 9, sendWeekday: 3 };
    expect(shouldRunDigest("Weekly", null, MON_0901_ET, WED)).toBe(false);
    expect(shouldRunDigest("Weekly", null, WED_0901_ET, WED)).toBe(true);
  });
});

describe("runDigest", () => {
  function notif(overrides: Record<string, unknown> = {}) {
    return {
      id: "n1",
      recipientUserId: "u1",
      eventType: "education.discussion",
      title: "New reply",
      body: "hey",
      link: "/education/o1/hub",
      createdAt: new Date(WED_0901_ET.getTime() - 3_600_000),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      { userId: "u1", eventType: "education.discussion" },
    ]);
    mockPrisma.notification.findMany.mockResolvedValue([notif()]);
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: "u1",
        firstName: "Ada",
        daliEmail: "ada@dali.dartmouth.edu",
        dartmouthEmail: null,
        personalEmail: null,
      },
    ]);
    mockGetSender.mockResolvedValue({
      id: "g-1",
      refreshToken: "token",
      sendAsEmail: "dalios@dali.dartmouth.edu",
    });
    mockSendEmail.mockResolvedValue({});
  });

  it("emails matched unread rows and marks exactly those emailedAt", async () => {
    const result = await runDigest("Daily", WED_0901_ET);
    expect(result.items).toBe(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ada@dali.dartmouth.edu",
        subject: "Your DALI digest — 1 update",
      }),
    );
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["n1"] } },
      data: { emailedAt: WED_0901_ET },
    });
  });

  it("selects only unread, un-emailed rows inside the cadence window", async () => {
    await runDigest("Daily", WED_0901_ET);
    const where = mockPrisma.notification.findMany.mock.calls[0][0].where;
    expect(where.emailedAt).toBeNull();
    expect(where.readAt).toBeNull();
    expect(where.createdAt).toEqual({
      gte: new Date(WED_0901_ET.getTime() - 26 * 3_600_000),
    });
    // Cancelled-meeting rows excluded (shared inbox filter).
    expect(where.OR).toBeDefined();
  });

  it("skips rows whose eventType the user did not subscribe to", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([
      notif({ eventType: "education.certificate" }),
    ]);
    const result = await runDigest("Daily", WED_0901_ET);
    expect(result).toEqual({ items: 0, note: "nothing unread" });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("no subscribers → no queries beyond prefs", async () => {
    mockPrisma.notificationPreference.findMany.mockResolvedValue([]);
    const result = await runDigest("Daily", WED_0901_ET);
    expect(result).toEqual({ items: 0, note: "no subscribers" });
    expect(mockPrisma.notification.findMany).not.toHaveBeenCalled();
  });

  it("a failed send leaves that user's rows unmarked but continues to others", async () => {
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      { userId: "u1", eventType: "education.discussion" },
      { userId: "u2", eventType: "education.discussion" },
    ]);
    mockPrisma.notification.findMany.mockResolvedValue([
      notif(),
      notif({ id: "n2", recipientUserId: "u2" }),
    ]);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", firstName: "Ada", daliEmail: "ada@d", dartmouthEmail: null, personalEmail: null },
      { id: "u2", firstName: "Bo", daliEmail: "bo@d", dartmouthEmail: null, personalEmail: null },
    ]);
    mockSendEmail.mockRejectedValueOnce(new Error("bounce")).mockResolvedValueOnce({});

    const result = await runDigest("Daily", WED_0901_ET);
    expect(result.items).toBe(1);
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["n2"] } } }),
    );
  });
});

describe("renderDigestEmail", () => {
  it("groups rows by registry label and absolutizes links", () => {
    const { subject, html } = renderDigestEmail({
      firstName: "Ada",
      now: WED_0901_ET,
      rows: [
        {
          eventType: "education.discussion",
          title: "New reply",
          body: "hey",
          link: "/education/o1/hub",
          createdAt: new Date(WED_0901_ET.getTime() - 2 * 3_600_000),
        },
        {
          eventType: "meeting.reminder",
          title: "Starting soon",
          body: null,
          link: null,
          createdAt: new Date(WED_0901_ET.getTime() - 3_600_000),
        },
      ],
    });
    expect(subject).toBe("Your DALI digest — 2 updates");
    expect(html).toContain("Discussion replies");
    expect(html).toContain("Meeting reminders");
    expect(html).toContain("https://os.dali.dartmouth.edu/education/o1/hub");
    expect(html).toContain("2h ago");
  });
});
