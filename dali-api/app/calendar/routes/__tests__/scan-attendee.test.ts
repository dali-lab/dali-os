import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response("Forbidden", { status: 403 })),
}));
vi.mock("~/lib/db", () => ({
  prisma: {
    scheduledMeeting: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: vi.fn((_req: Request, res: Response) => res),
  handlePreflight: vi.fn(() => null),
}));
vi.mock("~/lib/validate", () => ({ parseJson: vi.fn() }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn() }));
vi.mock("~/lib/scheduled-meeting", () => ({
  markMeetingAttendance: vi.fn(),
  isWithinCheckInWindow: vi.fn(),
}));
vi.mock("~/lib/wallet-token", () => ({
  memberIdFromToken: vi.fn(),
  verifyWalletToken: vi.fn(),
  walletTokensConfigured: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore, isProjectMember } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { resolvePhotoUrl } from "~/lib/photo";
import { markMeetingAttendance, isWithinCheckInWindow } from "~/lib/scheduled-meeting";
import { memberIdFromToken, verifyWalletToken, walletTokensConfigured } from "~/lib/wallet-token";
import { action } from "~/calendar/routes/api.scheduled-meetings.$id.scan-attendee";

const m = {
  scheduledMeeting: prisma.scheduledMeeting.findUnique as unknown as ReturnType<typeof vi.fn>,
  user: prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>,
};

function callAction() {
  const request = new Request("http://localhost/api/scheduled-meetings/m1/scan-attendee", {
    method: "POST",
  });
  return action({ request, params: { id: "m1" } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "op1", type: "member" } } as never);
  vi.mocked(walletTokensConfigured).mockReturnValue(true);
  vi.mocked(parseJson).mockResolvedValue({ memberToken: "tok" } as never);
  m.scheduledMeeting.mockResolvedValue({
    id: "m1",
    organizerId: "op1",
    projectId: null,
    meetingType: "Group",
    selectedAt: new Date(),
    durationMinutes: 60,
  });
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(isWithinCheckInWindow).mockReturnValue(true);
  vi.mocked(memberIdFromToken).mockReturnValue("u2");
  m.user.mockResolvedValue({
    id: "u2",
    firstName: "Ada",
    lastName: "Lovelace",
    photoUrl: "raw-key",
    walletPassSecret: "sec",
  });
  vi.mocked(verifyWalletToken).mockReturnValue({ ok: true, memberId: "u2" });
  vi.mocked(markMeetingAttendance).mockResolvedValue({ ok: true });
  vi.mocked(resolvePhotoUrl).mockResolvedValue("https://cdn/ada.jpg");
});

describe("scan-attendee action", () => {
  it("marks the scanned member present and echoes their card", async () => {
    const res = await callAction();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      member: { id: "u2", firstName: "Ada", lastName: "Lovelace", photoUrl: "https://cdn/ada.jpg" },
    });
    // The operator (op1) is the markedBy; the member comes from the token.
    expect(markMeetingAttendance).toHaveBeenCalledWith("m1", "u2", true, "op1");
  });

  it("403s an operator who isn't organizer, Core, or a project member", async () => {
    m.scheduledMeeting.mockResolvedValue({
      id: "m1",
      organizerId: "someone-else",
      projectId: "p1",
      meetingType: "Group",
      selectedAt: new Date(),
      durationMinutes: 60,
    });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    const res = await callAction();
    expect(res.status).toBe(403);
    expect(markMeetingAttendance).not.toHaveBeenCalled();
  });

  it("403s outside the check-in window", async () => {
    vi.mocked(isWithinCheckInWindow).mockReturnValue(false);
    const res = await callAction();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("window") });
    expect(markMeetingAttendance).not.toHaveBeenCalled();
  });

  it("400s a structurally invalid token without touching the DB", async () => {
    vi.mocked(memberIdFromToken).mockReturnValue(null);
    const res = await callAction();
    expect(res.status).toBe(400);
    expect(m.user).not.toHaveBeenCalled();
    expect(markMeetingAttendance).not.toHaveBeenCalled();
  });

  it("400s a revoked pass (signature no longer verifies)", async () => {
    vi.mocked(verifyWalletToken).mockReturnValue({ ok: false });
    const res = await callAction();
    expect(res.status).toBe(400);
    expect(markMeetingAttendance).not.toHaveBeenCalled();
  });

  it("propagates the not-invited error from markMeetingAttendance", async () => {
    vi.mocked(markMeetingAttendance).mockResolvedValue({
      ok: false,
      error: "User was not invited to this meeting",
      status: 400,
    });
    const res = await callAction();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "User was not invited to this meeting" });
  });

  it("503s when wallet check-in isn't configured", async () => {
    vi.mocked(walletTokensConfigured).mockReturnValue(false);
    const res = await callAction();
    expect(res.status).toBe(503);
    expect(markMeetingAttendance).not.toHaveBeenCalled();
  });

  it("forbids applicants", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { sub: "a1", type: "applicant" },
    } as never);
    const res = await callAction();
    expect(res.status).toBe(403);
  });

  it("is idempotent on a repeat scan (still ok)", async () => {
    await callAction();
    const res = await callAction();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
