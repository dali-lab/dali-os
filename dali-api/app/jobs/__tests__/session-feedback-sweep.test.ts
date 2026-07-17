import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/education/lib/feedback.server", () => ({
  requestSessionFeedback: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requestSessionFeedback } from "~/education/lib/feedback.server";
import { runSessionFeedbackSweep } from "~/jobs/session-feedback-sweep.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockRequest = requestSessionFeedback as unknown as ReturnType<typeof vi.fn>;

const HOUR = 3_600_000;
const NOW = new Date("2026-07-15T12:00:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.educationSession.findMany.mockResolvedValue([]);
  mockPrisma.educationApplication.findMany.mockResolvedValue([]);
  mockRequest.mockResolvedValue(undefined);
});

describe("runSessionFeedbackSweep", () => {
  it("scans only ended, un-swept sessions of active offerings", async () => {
    await runSessionFeedbackSweep({ now: NOW, lastSuccessAt: null, settings: { graceHours: 2, lookbackDays: 14 } });
    expect(mockPrisma.educationSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          feedbackRequestedAt: null,
          datetime: {
            lte: new Date(NOW.getTime() - 2 * HOUR),
            gte: new Date(NOW.getTime() - 14 * 24 * HOUR),
          },
          offering: { status: "Published", closedOutAt: null },
        }),
      }),
    );
  });

  it("asks Present attendees when attendance exists", async () => {
    mockPrisma.educationSession.findMany.mockResolvedValue([
      {
        id: "s1",
        offeringId: "o1",
        attendances: [
          { application: { applicantUserId: "u1" } },
          { application: { applicantUserId: "u2" } },
        ],
      },
    ]);
    const result = await runSessionFeedbackSweep({ now: NOW, lastSuccessAt: null, settings: { graceHours: 2, lookbackDays: 14 } });
    expect(mockRequest).toHaveBeenCalledWith({
      offeringId: "o1",
      sessionId: "s1",
      presentUserIds: ["u1", "u2"],
    });
    // No enrollee lookup needed when attendance exists.
    expect(mockPrisma.educationApplication.findMany).not.toHaveBeenCalled();
    expect(result.items).toBe(1);
  });

  it("falls back to all Approved enrollees when zero attendance was marked", async () => {
    mockPrisma.educationSession.findMany.mockResolvedValue([
      { id: "s1", offeringId: "o1", attendances: [] },
    ]);
    mockPrisma.educationApplication.findMany.mockResolvedValue([
      { applicantUserId: "u3" },
      { applicantUserId: "u4" },
    ]);
    await runSessionFeedbackSweep({ now: NOW, lastSuccessAt: null, settings: { graceHours: 2, lookbackDays: 14 } });
    expect(mockPrisma.educationApplication.findMany).toHaveBeenCalledWith({
      where: { offeringId: "o1", status: "Approved" },
      select: { applicantUserId: true },
    });
    expect(mockRequest).toHaveBeenCalledWith({
      offeringId: "o1",
      sessionId: "s1",
      presentUserIds: ["u3", "u4"],
    });
  });

  it("skips sessions with no attendance and no enrollees", async () => {
    mockPrisma.educationSession.findMany.mockResolvedValue([
      { id: "s1", offeringId: "o1", attendances: [] },
    ]);
    const result = await runSessionFeedbackSweep({ now: NOW, lastSuccessAt: null, settings: { graceHours: 2, lookbackDays: 14 } });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("continues past a failing session", async () => {
    mockPrisma.educationSession.findMany.mockResolvedValue([
      { id: "s1", offeringId: "o1", attendances: [{ application: { applicantUserId: "u1" } }] },
      { id: "s2", offeringId: "o1", attendances: [{ application: { applicantUserId: "u2" } }] },
    ]);
    mockRequest.mockRejectedValueOnce(new Error("boom"));
    const result = await runSessionFeedbackSweep({ now: NOW, lastSuccessAt: null, settings: { graceHours: 2, lookbackDays: 14 } });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(result.items).toBe(1);
  });
});
