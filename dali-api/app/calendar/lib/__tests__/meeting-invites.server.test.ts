import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { buildPerRecipientIcs, meetingUid } from "~/calendar/lib/meeting-invites.server";

const baseArgs = {
  meetingId: "m1",
  method: "REQUEST" as const,
  title: "Sync",
  startTime: new Date("2026-09-10T15:00:00Z"),
  durationMinutes: 60,
  organizerEmail: "organizer@example.edu",
  recurrenceRule: null,
  userIds: ["u1", "u2", "u3"],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findMany).mockResolvedValue([
    { id: "u1", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu", dartmouthEmail: null },
    { id: "u2", firstName: "Grace", lastName: "Hopper", daliEmail: null, dartmouthEmail: "grace@example.edu" },
    { id: "u3", firstName: "No", lastName: "Email", daliEmail: null, dartmouthEmail: null },
  ] as never);
});

describe("meetingUid", () => {
  it("is stable for a meeting and distinct between meetings", () => {
    expect(meetingUid("m1")).toBe("meeting-m1@dali.dartmouth.edu");
    expect(meetingUid("m1")).toBe(meetingUid("m1"));
    expect(meetingUid("m2")).not.toBe(meetingUid("m1"));
  });
});

describe("buildPerRecipientIcs", () => {
  it("makes one ICS per recipient that lists only that recipient", async () => {
    const byUser = await buildPerRecipientIcs(baseArgs);

    expect([...byUser.keys()]).toEqual(["u1", "u2"]);
    expect(byUser.get("u1")).toContain("ada@example.edu");
    expect(byUser.get("u1")).not.toContain("grace@example.edu");
    expect(byUser.get("u2")).toContain("grace@example.edu");
    expect(byUser.get("u2")).not.toContain("ada@example.edu");
  });

  it("skips recipients with no email", async () => {
    const byUser = await buildPerRecipientIcs(baseArgs);
    expect(byUser.has("u3")).toBe(false);
  });

  it("uses the meeting uid and sequence 0 for an invite", async () => {
    const ics = (await buildPerRecipientIcs(baseArgs)).get("u1")!;
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain(`UID:${meetingUid("m1")}`);
    expect(ics).toContain("SEQUENCE:0");
  });

  it("uses sequence 1 and a cancelled status for a cancel", async () => {
    const ics = (await buildPerRecipientIcs({ ...baseArgs, method: "CANCEL" })).get("u1")!;
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("SEQUENCE:1");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("looks up only the requested users", async () => {
    await buildPerRecipientIcs(baseArgs);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["u1", "u2", "u3"] } } }),
    );
  });
});
