import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  return { McpError, McpNotFoundError, McpForbiddenError, McpInvalidError };
});
vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn(), isProjectMember: vi.fn() };
});
vi.mock("~/calendar/lib/meeting-roster.server", () => ({
  markMeetingAttendance: vi.fn(),
}));
vi.mock("~/wallet/lib/wallet-token.server", () => ({
  walletTokensConfigured: vi.fn(),
  memberIdFromToken: vi.fn(),
  verifyWalletToken: vi.fn(),
  classifyWalletScanFailure: vi.fn(() => "signature-mismatch"),
}));
vi.mock("~/lib/photo", () => ({
  resolvePhotoUrl: vi.fn(async (url: string | null) => url ?? null),
}));

import { prisma } from "~/lib/db.server";
import { isCore, isProjectMember } from "~/lib/roles";
import { markMeetingAttendance } from "~/calendar/lib/meeting-roster.server";
import { walletTokensConfigured, memberIdFromToken, verifyWalletToken } from "~/wallet/lib/wallet-token.server";
import { runMarkMeetingAttendance, MARK_MEETING_ATTENDANCE_DEF } from "~/mcp/tools/calendar-extra/mark-meeting-attendance";

const runScanAttendee = (callerId: string, input: { meetingId: string; memberToken: string }) =>
  runMarkMeetingAttendance(callerId, input);

const mockPrisma = prisma as unknown as {
  scheduledMeeting: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

const MEETING = {
  id: "m1",
  organizerId: "u-org",
  projectId: null,
  meetingType: "Other",
  selectedAt: new Date(Date.now() + 5 * 60_000), // 5 min from now
  durationMinutes: 60,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("mark_meeting_attendance with memberToken", () => {
  it("requires mcp:write scope and offers memberToken beside userId", () => {
    expect(MARK_MEETING_ATTENDANCE_DEF.requiredScope).toBe("mcp:write");
    expect(MARK_MEETING_ATTENDANCE_DEF.inputSchema.properties).toHaveProperty("memberToken");
    expect(MARK_MEETING_ATTENDANCE_DEF.inputSchema.required).toEqual(["meetingId"]);
  });

  it("needs exactly one of userId or memberToken", async () => {
    await expect(runMarkMeetingAttendance("u-org", { meetingId: "m1", present: true })).rejects.toMatchObject({
      name: "McpInvalidError",
    });
    await expect(
      runMarkMeetingAttendance("u-org", { meetingId: "m1", userId: "u2", memberToken: "tok", present: true }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
    expect(mockPrisma.scheduledMeeting.findUnique).not.toHaveBeenCalled();
  });

  it("requires present with userId and refuses to mark a scanned pass absent", async () => {
    await expect(runMarkMeetingAttendance("u-org", { meetingId: "m1", userId: "u2" })).rejects.toMatchObject({
      name: "McpInvalidError",
    });
    await expect(
      runMarkMeetingAttendance("u-org", { meetingId: "m1", memberToken: "tok", present: false }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
    expect(markMeetingAttendance).not.toHaveBeenCalled();
  });

  it("scans a meeting that has no attendance roster", async () => {
    vi.mocked(walletTokensConfigured).mockReturnValue(true);
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue({ id: "m1", organizerId: "u-org", projectId: null });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    vi.mocked(memberIdFromToken).mockReturnValue("u-member");
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u-member", firstName: "D", lastName: "B", photoUrl: null, walletPassSecret: "s" });
    vi.mocked(verifyWalletToken).mockReturnValue({ ok: true, memberId: "u-member" });
    vi.mocked(markMeetingAttendance).mockResolvedValue({ ok: true });
    const out = await runScanAttendee("u-org", { meetingId: "m1", memberToken: "tok" });
    expect(out.ok).toBe(true);
    expect(markMeetingAttendance).toHaveBeenCalledWith("m1", "u-member", true, "u-org", expect.any(Date));
  });

  it("throws McpInvalidError when wallet tokens not configured", async () => {
    vi.mocked(walletTokensConfigured).mockReturnValue(false);
    await expect(
      runScanAttendee("u-org", { meetingId: "m1", memberToken: "tok" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("throws McpNotFoundError when meeting is missing", async () => {
    vi.mocked(walletTokensConfigured).mockReturnValue(true);
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(null);
    await expect(
      runScanAttendee("u-org", { meetingId: "missing", memberToken: "tok" }),
    ).rejects.toMatchObject({ name: "McpNotFoundError" });
  });

  it("throws McpForbiddenError for non-operator caller", async () => {
    vi.mocked(walletTokensConfigured).mockReturnValue(true);
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(MEETING);
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(isProjectMember).mockResolvedValue(false);

    await expect(
      runScanAttendee("u-other", { meetingId: "m1", memberToken: "tok" }),
    ).rejects.toMatchObject({ name: "McpForbiddenError" });
  });


  it("throws McpInvalidError for invalid token", async () => {
    vi.mocked(walletTokensConfigured).mockReturnValue(true);
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(MEETING);
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    vi.mocked(memberIdFromToken).mockReturnValue(null);

    await expect(
      runScanAttendee("u-core", { meetingId: "m1", memberToken: "bad-tok" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("returns member info on successful scan", async () => {
    vi.mocked(walletTokensConfigured).mockReturnValue(true);
    mockPrisma.scheduledMeeting.findUnique.mockResolvedValue(MEETING);
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isProjectMember).mockResolvedValue(false);
    vi.mocked(memberIdFromToken).mockReturnValue("u-member");
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "u-member",
      firstName: "Dave",
      lastName: "Brown",
      photoUrl: null,
      walletPassSecret: "secret",
    });
    vi.mocked(verifyWalletToken).mockReturnValue({ ok: true, memberId: "u-member" });
    vi.mocked(markMeetingAttendance).mockResolvedValue({ ok: true });

    const out = await runScanAttendee("u-core", { meetingId: "m1", memberToken: "valid-tok" });
    expect(out.ok).toBe(true);
    expect(out.member).toMatchObject({ id: "u-member", firstName: "Dave", lastName: "Brown" });
  });
});
