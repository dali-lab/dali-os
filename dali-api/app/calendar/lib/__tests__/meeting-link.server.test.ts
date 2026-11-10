import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
vi.mock("~/lib/db.server", () => ({ prisma: { scheduledMeeting: { findUnique } } }));

const { meetingLinkRedirect } = await import("~/calendar/lib/meeting-link.server");

const link = (qs: string) => new URL(`http://localhost/calendar${qs}`);

beforeEach(() => vi.clearAllMocks());

describe("meetingLinkRedirect", () => {
  it("opens a live meeting's page", async () => {
    findUnique.mockResolvedValue({ status: "Confirmed" });
    const res = await meetingLinkRedirect(link("?meeting=m1"));
    expect(res?.status).toBe(302);
    expect(res?.headers.get("Location")).toBe("/calendar/meeting/m1");
  });

  it("leaves a plain calendar load alone without a query", async () => {
    await expect(meetingLinkRedirect(link("?view=day"))).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("stays on the calendar for a cancelled meeting, whose page 404s", async () => {
    findUnique.mockResolvedValue({ status: "Cancelled" });
    await expect(meetingLinkRedirect(link("?meeting=m1"))).resolves.toBeNull();
  });

  it("stays on the calendar for a meeting that no longer exists", async () => {
    findUnique.mockResolvedValue(null);
    await expect(meetingLinkRedirect(link("?meeting=gone"))).resolves.toBeNull();
  });

  it("can't be steered off the meeting route by the id", async () => {
    findUnique.mockResolvedValue({ status: "Confirmed" });
    const res = await meetingLinkRedirect(link("?meeting=" + encodeURIComponent("../../admin")));
    expect(res?.headers.get("Location")).toBe("/calendar/meeting/..%2F..%2Fadmin");
  });
});
