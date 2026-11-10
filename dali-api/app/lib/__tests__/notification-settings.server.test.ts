import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ isPartnerAccount: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/settings-page.server", () => ({
  loadDigestSchedule: vi.fn(async () => ({ dailyHour: 9, weeklyHour: 9, weeklyWeekday: 1 })),
}));

import { prisma } from "~/lib/db.server";
import { isNonMember, isPartnerAccount } from "~/lib/auth";
import {
  loadOutsideNotificationSettings,
  notificationAudience,
  saveNotificationSettings,
} from "~/lib/notification-settings.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

const outside = (audience: "portal" | "partner") => ({ audience, isAdmin: false, isCore: false });

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const written = () =>
  mockPrisma.notificationPreference.upsert.mock.calls.map((c) => (c[0] as { create: unknown }).create);

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockResolvedValue([]);
  mockPrisma.notificationPreference.upsert.mockImplementation((args: unknown) => args);
});

describe("notificationAudience", () => {
  const auth = { user: { sub: "u1" } } as never;
  const request = new Request("http://localhost/");

  it("puts partner accounts first", async () => {
    vi.mocked(isPartnerAccount).mockResolvedValue(true);
    vi.mocked(isNonMember).mockResolvedValue(true);
    expect(await notificationAudience(auth, request)).toBe("partner");
  });

  it("treats other non-members as portal users and members as members", async () => {
    vi.mocked(isPartnerAccount).mockResolvedValue(false);
    vi.mocked(isNonMember).mockResolvedValue(true);
    expect(await notificationAudience(auth, request)).toBe("portal");
    vi.mocked(isNonMember).mockResolvedValue(false);
    expect(await notificationAudience(auth, request)).toBe("member");
  });
});

describe("saveNotificationSettings for outside users", () => {
  it("saves in-app and email, never desktop or Slack", async () => {
    const res = await saveNotificationSettings(
      "u1",
      form({
        "education.assignment:present": "1",
        "education.assignment:inApp": "on",
        "education.assignment:desktop": "on",
        "education.assignment:slackDm": "on",
        "education.assignment:email": "Off",
      }),
      outside("portal"),
    );
    expect(res).toEqual({ ok: true, error: null });
    expect(written()).toEqual([
      {
        userId: "u1",
        eventType: "education.assignment",
        inApp: true,
        desktop: false,
        slackDm: false,
        digestFrequency: "Off",
      },
    ]);
  });

  it("replaces a digest choice with the outside default", async () => {
    await saveNotificationSettings(
      "u1",
      form({ "education.grade:present": "1", "education.grade:email": "Daily" }),
      outside("portal"),
    );
    expect(written()[0]).toMatchObject({ eventType: "education.grade", digestFrequency: "Instant" });
  });

  it("ignores events the audience can't receive", async () => {
    const res = await saveNotificationSettings(
      "u1",
      form({
        "meeting.invite:present": "1",
        "meeting.invite:email": "Instant",
        "education.assignment:present": "1",
        "education.assignment:email": "Off",
      }),
      outside("partner"),
    );
    expect(res).toEqual({ ok: false, error: "Nothing to save." });
    expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("saves a partner's comment replies", async () => {
    await saveNotificationSettings(
      "p1",
      form({ "collab.comment_reply:present": "1", "collab.comment_reply:email": "Off" }),
      outside("partner"),
    );
    expect(written()).toEqual([
      expect.objectContaining({ userId: "p1", eventType: "collab.comment_reply", inApp: false }),
    ]);
  });
});

describe("saveNotificationSettings for members", () => {
  it("keeps digests, desktop and Slack", async () => {
    await saveNotificationSettings(
      "u1",
      form({
        "education.discussion:present": "1",
        "education.discussion:desktop": "on",
        "education.discussion:slackDm": "on",
        "education.discussion:email": "Weekly",
      }),
      { audience: "member", isAdmin: false, isCore: false },
    );
    expect(written()[0]).toMatchObject({
      inApp: true,
      desktop: true,
      slackDm: true,
      digestFrequency: "Weekly",
    });
  });
});

describe("loadOutsideNotificationSettings", () => {
  it("returns the viewer's rows with no Slack, admin or Core access", async () => {
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      { eventType: "education.grade", inApp: true, desktop: false, slackDm: false, digestFrequency: "Off" },
    ]);
    const data = await loadOutsideNotificationSettings("u1", "portal", "/portal/settings");
    expect(mockPrisma.notificationPreference.findMany.mock.calls[0][0].where).toEqual({ userId: "u1" });
    expect(data).toMatchObject({
      slackConnected: false,
      isAdmin: false,
      isCore: false,
      audience: "portal",
      action: "/portal/settings",
    });
    expect(data.prefs).toHaveLength(1);
  });
});
