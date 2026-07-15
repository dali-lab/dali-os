import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: vi.fn(),
  isPartnerAccount: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth, isPartnerAccount } from "~/lib/auth";
import { action } from "~/routes/settings.notifications";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };
const mockAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockIsPartner = isPartnerAccount as ReturnType<typeof vi.fn>;

function post(fields: Record<string, string>) {
  const form = new URLSearchParams(fields);
  const request = new Request("http://localhost/settings/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  return action({ request, params: {}, context: {} } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ ok: true, user: { sub: "u1", type: "member" } });
  mockIsPartner.mockResolvedValue(false);
  mockPrisma.$transaction.mockResolvedValue([]);
  // upsert returns the builder arg for call-shape assertions
  mockPrisma.notificationPreference.upsert.mockImplementation((args: unknown) => args);
});

describe("settings.notifications action", () => {
  it("upserts a row keyed on userId_eventType with the submitted values", async () => {
    const res = await post({
      "education.discussion:present": "1",
      "education.discussion:inApp": "on",
      "education.discussion:slackDm": "on",
      "education.discussion:email": "Daily",
    });
    expect(res).toEqual({ ok: true, error: null });

    expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: {
        userId_eventType: { userId: "u1", eventType: "education.discussion" },
      },
      update: { inApp: true, slackDm: true, digestFrequency: "Daily" },
      create: {
        userId: "u1",
        eventType: "education.discussion",
        inApp: true,
        slackDm: true,
        digestFrequency: "Daily",
      },
    });
  });

  it("treats absent checkboxes as off and ignores rows without the present marker", async () => {
    await post({
      "education.discussion:present": "1",
      "education.discussion:email": "Off",
      // no present marker → row must not be written even with fields set
      "education.certificate:inApp": "on",
      "education.certificate:email": "Instant",
    });
    expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { inApp: false, slackDm: false, digestFrequency: "Off" },
      }),
    );
  });

  it("forces inApp true for lockedInApp events", async () => {
    await post({
      "meeting.invite:present": "1",
      // inApp deliberately unchecked
      "meeting.invite:email": "Off",
    });
    expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ inApp: true }),
      }),
    );
  });

  it("falls back to the registry default on a tampered digest value", async () => {
    await post({
      "education.announcement:present": "1",
      "education.announcement:email": "Hourly",
    });
    expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        // education.announcement's registry default is Instant
        update: expect.objectContaining({ digestFrequency: "Instant" }),
      }),
    );
  });

  it("rejects unauthenticated and partner accounts", async () => {
    mockAuth.mockResolvedValue({ ok: false });
    let res = (await post({ "education.discussion:present": "1" })) as Response;
    expect(res.status).toBe(401);

    mockAuth.mockResolvedValue({ ok: true, user: { sub: "u1", type: "member" } });
    mockIsPartner.mockResolvedValue(true);
    res = (await post({ "education.discussion:present": "1" })) as Response;
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
