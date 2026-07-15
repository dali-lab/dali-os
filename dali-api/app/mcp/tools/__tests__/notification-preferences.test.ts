import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  runListNotificationPreferences,
  runSetNotificationPreference,
  LIST_NOTIFICATION_PREFERENCES_TOOL,
  SET_NOTIFICATION_PREFERENCE_TOOL,
  PreferenceValidationError,
} from "~/mcp/tools/notification-preferences";

const mockPrisma = prisma as unknown as {
  notificationPreference: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.notificationPreference.findMany.mockResolvedValue([]);
  mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);
  mockPrisma.notificationPreference.upsert.mockResolvedValue({});
});

describe("list_notification_preferences", () => {
  it("requires only the read scope", () => {
    expect(LIST_NOTIFICATION_PREFERENCES_TOOL.requiredScope).toBe("mcp:read");
  });

  it("resolves registry defaults and marks explicit rows", async () => {
    mockPrisma.notificationPreference.findMany.mockResolvedValue([
      {
        userId: "u1",
        eventType: "task.assigned",
        inApp: false,
        slackDm: false,
        digestFrequency: "Daily",
      },
    ]);

    const out = await runListNotificationPreferences("u1");
    const byType = new Map(out.preferences.map((p) => [p.eventType, p]));

    // Hidden backfill value never appears.
    expect(out.preferences.some((p) => (p.eventType as string) === "general")).toBe(false);
    const assigned = byType.get("task.assigned")!;
    expect(assigned).toMatchObject({
      inApp: false,
      email: "Daily",
      explicit: true,
    });
    const dueReminder = byType.get("task.due_reminder")!;
    expect(dueReminder).toMatchObject({
      inApp: true,
      slackDm: true, // registry default
      email: "Off",
      explicit: false,
    });
    // Locked events always report in-app on.
    expect(byType.get("meeting.invite")).toMatchObject({
      inApp: true,
      lockedInApp: true,
    });
  });
});

describe("set_notification_preference", () => {
  it("requires the write scope", () => {
    expect(SET_NOTIFICATION_PREFERENCE_TOOL.requiredScope).toBe("mcp:write");
  });

  it("merges omitted fields from the current effective values", async () => {
    const out = await runSetNotificationPreference("u1", {
      eventType: "task.assigned",
      email: "Weekly",
    });

    expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId_eventType: { userId: "u1", eventType: "task.assigned" } },
      update: { inApp: true, slackDm: true, digestFrequency: "Weekly" },
      create: {
        userId: "u1",
        eventType: "task.assigned",
        inApp: true, // registry default
        slackDm: true, // registry default
        digestFrequency: "Weekly",
      },
    });
    expect(out).toMatchObject({ ok: true, email: "Weekly" });
  });

  it("prefers an existing row over registry defaults when merging", async () => {
    mockPrisma.notificationPreference.findUnique.mockResolvedValue({
      inApp: false,
      slackDm: false,
      digestFrequency: "Daily",
    });

    await runSetNotificationPreference("u1", {
      eventType: "task.assigned",
      slackDm: true,
    });

    const call = mockPrisma.notificationPreference.upsert.mock.calls[0][0];
    expect(call.update).toEqual({
      inApp: false,
      slackDm: true,
      digestFrequency: "Daily",
    });
  });

  it("rejects muting a locked in-app event", async () => {
    await expect(
      runSetNotificationPreference("u1", {
        eventType: "meeting.invite",
        inApp: false,
      }),
    ).rejects.toBeInstanceOf(PreferenceValidationError);
    expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("rejects email settings on externally-emailed events", async () => {
    await expect(
      runSetNotificationPreference("u1", {
        eventType: "education.decision",
        email: "Instant",
      }),
    ).rejects.toBeInstanceOf(PreferenceValidationError);
  });

  it("rejects unknown event types", async () => {
    await expect(
      runSetNotificationPreference("u1", { eventType: "nope.nope" }),
    ).rejects.toBeInstanceOf(PreferenceValidationError);
  });
});
