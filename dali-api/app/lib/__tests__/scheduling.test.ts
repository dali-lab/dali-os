import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  isReviewerFree,
  generateCandidateSlots,
  computeAvailableSlots,
  assignReviewers,
  reassignReviewer,
} from "~/lib/scheduling";

const mockPrisma = prisma as unknown as {
  interviewConfig: { findUnique: ReturnType<typeof vi.fn> };
  cycleReviewer: { findMany: ReturnType<typeof vi.fn> };
  interviewAssignment: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  interview: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  application: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── isReviewerFree ─────────────────────────────────────────────────────────

describe("isReviewerFree", () => {
  const slotStart = new Date("2026-04-15T14:00:00Z");
  const slotEnd = new Date("2026-04-15T14:30:00Z");

  it("returns true when availability covers slot and no conflicts", () => {
    const reviewer = {
      cycleReviewerId: "r1",
      domainId: "d1",
      availability: [
        { startTime: new Date("2026-04-15T13:00:00Z"), endTime: new Date("2026-04-15T17:00:00Z") },
      ],
      bookedIntervals: [],
    };
    expect(isReviewerFree(reviewer, slotStart, slotEnd)).toBe(true);
  });

  it("returns false when no availability block covers the slot", () => {
    const reviewer = {
      cycleReviewerId: "r1",
      domainId: "d1",
      availability: [
        { startTime: new Date("2026-04-15T15:00:00Z"), endTime: new Date("2026-04-15T17:00:00Z") },
      ],
      bookedIntervals: [],
    };
    expect(isReviewerFree(reviewer, slotStart, slotEnd)).toBe(false);
  });

  it("returns false when availability only partially covers the slot", () => {
    const reviewer = {
      cycleReviewerId: "r1",
      domainId: "d1",
      availability: [
        { startTime: new Date("2026-04-15T14:00:00Z"), endTime: new Date("2026-04-15T14:20:00Z") },
      ],
      bookedIntervals: [],
    };
    expect(isReviewerFree(reviewer, slotStart, slotEnd)).toBe(false);
  });

  it("returns false when a booked interval overlaps the slot", () => {
    const reviewer = {
      cycleReviewerId: "r1",
      domainId: "d1",
      availability: [
        { startTime: new Date("2026-04-15T13:00:00Z"), endTime: new Date("2026-04-15T17:00:00Z") },
      ],
      bookedIntervals: [
        { start: new Date("2026-04-15T14:15:00Z"), end: new Date("2026-04-15T15:00:00Z") },
      ],
    };
    expect(isReviewerFree(reviewer, slotStart, slotEnd)).toBe(false);
  });

  it("returns true when booked interval ends exactly at slot start (no overlap)", () => {
    const reviewer = {
      cycleReviewerId: "r1",
      domainId: "d1",
      availability: [
        { startTime: new Date("2026-04-15T13:00:00Z"), endTime: new Date("2026-04-15T17:00:00Z") },
      ],
      bookedIntervals: [
        { start: new Date("2026-04-15T13:00:00Z"), end: new Date("2026-04-15T14:00:00Z") },
      ],
    };
    expect(isReviewerFree(reviewer, slotStart, slotEnd)).toBe(true);
  });

  it("returns true when booked interval starts exactly at slot end (no overlap)", () => {
    const reviewer = {
      cycleReviewerId: "r1",
      domainId: "d1",
      availability: [
        { startTime: new Date("2026-04-15T13:00:00Z"), endTime: new Date("2026-04-15T17:00:00Z") },
      ],
      bookedIntervals: [
        { start: new Date("2026-04-15T14:30:00Z"), end: new Date("2026-04-15T15:30:00Z") },
      ],
    };
    expect(isReviewerFree(reviewer, slotStart, slotEnd)).toBe(true);
  });

  it("returns false with empty availability", () => {
    const reviewer = {
      cycleReviewerId: "r1",
      domainId: "d1",
      availability: [],
      bookedIntervals: [],
    };
    expect(isReviewerFree(reviewer, slotStart, slotEnd)).toBe(false);
  });
});

// ─── generateCandidateSlots ─────────────────────────────────────────────────

describe("generateCandidateSlots", () => {
  // Use fake time set to well before the date range so "future" filter passes
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // NOTE: start/end dates use T04:00:00Z (midnight EDT) so that
  // toLocaleDateString("en-CA", { timeZone: "America/New_York" }) resolves
  // to the intended calendar day (midnight UTC is still the previous evening in ET).

  it("generates slots within business hours on weekdays", () => {
    const start = new Date("2026-04-13T04:00:00Z"); // Monday midnight ET
    const end = new Date("2026-04-14T03:59:59Z");

    const slots = generateCandidateSlots(start, end, 9, 10, 30, "America/New_York");

    expect(slots.length).toBeGreaterThan(0);

    for (const slot of slots) {
      const localDay = new Date(slot.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
      expect(localDay).not.toBe(0); // not Sunday
      expect(localDay).not.toBe(6); // not Saturday
    }
  });

  it("skips weekends", () => {
    const start = new Date("2026-04-18T04:00:00Z"); // Saturday midnight ET
    const end = new Date("2026-04-20T03:59:59Z");   // through Sunday

    const slots = generateCandidateSlots(start, end, 9, 17, 30, "America/New_York");
    expect(slots).toHaveLength(0);
  });

  it("generates slots at 15-minute increments", () => {
    const start = new Date("2026-04-13T04:00:00Z"); // Monday midnight ET
    const end = new Date("2026-04-14T03:59:59Z");

    const slots = generateCandidateSlots(start, end, 9, 18, 30, "America/New_York");
    expect(slots.length).toBeGreaterThan(1);

    for (let i = 1; i < slots.length; i++) {
      const diff = slots[i].getTime() - slots[i - 1].getTime();
      expect(diff).toBe(15 * 60_000);
    }
  });

  it("does not generate slots that end after dayEndHour", () => {
    const start = new Date("2026-04-13T04:00:00Z"); // Monday midnight ET
    const end = new Date("2026-04-14T03:59:59Z");

    const slots = generateCandidateSlots(start, end, 9, 18, 30, "America/New_York");
    expect(slots.length).toBeGreaterThan(0);

    for (const slot of slots) {
      const slotEnd = new Date(slot.getTime() + 30 * 60_000);
      const localEnd = new Date(slotEnd.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const endHour = localEnd.getHours();
      const endMin = localEnd.getMinutes();
      expect(endHour < 18 || (endHour === 18 && endMin === 0)).toBe(true);
    }
  });

  it("spans multiple days", () => {
    const start = new Date("2026-04-13T04:00:00Z"); // Monday midnight ET
    const end = new Date("2026-04-15T03:59:59Z");   // through Tuesday

    const slots = generateCandidateSlots(start, end, 9, 18, 30, "America/New_York");

    const days = new Set(slots.map((s) =>
      new Date(s.toLocaleString("en-US", { timeZone: "America/New_York" })).getDate()
    ));
    expect(days.size).toBe(2);
  });
});

// ─── computeAvailableSlots ──────────────────────────────────────────────────

describe("computeAvailableSlots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty when no interview config exists", async () => {
    mockPrisma.interviewConfig.findUnique.mockResolvedValue(null);
    const slots = await computeAvailableSlots("cycle1", ["domain1"]);
    expect(slots).toEqual([]);
  });

  it("returns slots where both in-domain and cross-domain reviewers are free", async () => {
    mockPrisma.interviewConfig.findUnique.mockResolvedValue({
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      dayStartHour: 9,
      dayEndHour: 10,
      interviewStartDate: new Date("2026-04-13T04:00:00Z"), // Monday midnight ET
      interviewEndDate: new Date("2026-04-14T03:59:59Z"),
      timezone: "America/New_York",
    });

    // One in-domain reviewer, one cross-domain reviewer, both available all day
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([
      {
        id: "r1",
        domainId: "domain1",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T00:00:00Z"), endTime: new Date("2026-04-13T23:59:59Z") },
        ],
        interviewAssignments: [],
      },
      {
        id: "r2",
        domainId: "domain-other",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T00:00:00Z"), endTime: new Date("2026-04-13T23:59:59Z") },
        ],
        interviewAssignments: [],
      },
    ]);

    const slots = await computeAvailableSlots("cycle1", ["domain1"]);
    expect(slots.length).toBeGreaterThan(0);

    // Each slot should be 30 minutes
    for (const slot of slots) {
      const diff = new Date(slot.endTime).getTime() - new Date(slot.startTime).getTime();
      expect(diff).toBe(30 * 60_000);
    }
  });

  it("returns empty when no cross-domain reviewer is available", async () => {
    mockPrisma.interviewConfig.findUnique.mockResolvedValue({
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      dayStartHour: 9,
      dayEndHour: 10,
      interviewStartDate: new Date("2026-04-13T04:00:00Z"),
      interviewEndDate: new Date("2026-04-14T03:59:59Z"),
      timezone: "America/New_York",
    });

    // Only in-domain reviewers, no cross-domain
    mockPrisma.cycleReviewer.findMany.mockResolvedValue([
      {
        id: "r1",
        domainId: "domain1",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T00:00:00Z"), endTime: new Date("2026-04-13T23:59:59Z") },
        ],
        interviewAssignments: [],
      },
    ]);

    const slots = await computeAvailableSlots("cycle1", ["domain1"]);
    expect(slots).toEqual([]);
  });
});

// ─── assignReviewers ────────────────────────────────────────────────────────

describe("assignReviewers", () => {
  it("picks the least-scheduled reviewers and creates an interview", async () => {
    const createdInterview = {
      id: "int1",
      applicationId: "app1",
      applicationCycleId: "cycle1",
      startTime: new Date("2026-04-13T14:00:00Z"),
      endTime: new Date("2026-04-13T14:30:00Z"),
      status: "Scheduled",
      assignments: [
        { cycleReviewerId: "r1", role: "InDomain", status: "Active" },
        { cycleReviewerId: "r2", role: "CrossDomain", status: "Active" },
      ],
    };

    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewConfig: {
          findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }),
        },
        cycleReviewer: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "r1",
              domainId: "domain1",
              availabilityBlocks: [
                { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
              ],
              interviewAssignments: [{ interview: { startTime: new Date("2026-04-12T10:00:00Z"), endTime: new Date("2026-04-12T10:30:00Z") } }],
            },
            {
              id: "r1-busy",
              domainId: "domain1",
              availabilityBlocks: [
                { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
              ],
              // more active interviews -> should not be picked
              interviewAssignments: [
                { interview: { startTime: new Date("2026-04-12T10:00:00Z"), endTime: new Date("2026-04-12T10:30:00Z") } },
                { interview: { startTime: new Date("2026-04-12T11:00:00Z"), endTime: new Date("2026-04-12T11:30:00Z") } },
                { interview: { startTime: new Date("2026-04-12T12:00:00Z"), endTime: new Date("2026-04-12T12:30:00Z") } },
              ],
            },
            {
              id: "r2",
              domainId: "domain-other",
              availabilityBlocks: [
                { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
              ],
              interviewAssignments: [],
            },
          ]),
        },
        interview: {
          create: vi.fn().mockResolvedValue(createdInterview),
        },
      };
      return fn(tx);
    });

    const result = await assignReviewers(
      "cycle1", "app1", ["domain1"],
      new Date("2026-04-13T14:00:00Z"),
      new Date("2026-04-13T14:30:00Z"),
    );

    expect(result.id).toBe("int1");
    expect(result.assignments).toHaveLength(2);
  });

  it("throws when no interview config exists", async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewConfig: { findUnique: vi.fn().mockResolvedValue(null) },
      };
      return fn(tx);
    });

    await expect(
      assignReviewers("cycle1", "app1", ["domain1"], new Date(), new Date()),
    ).rejects.toThrow("No interview config for this cycle");
  });

  it("throws when no in-domain reviewer is available", async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewConfig: { findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }) },
        cycleReviewer: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "r2",
              domainId: "domain-other",
              availabilityBlocks: [
                { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
              ],
              interviewAssignments: [],
            },
          ]),
        },
      };
      return fn(tx);
    });

    await expect(
      assignReviewers(
        "cycle1", "app1", ["domain1"],
        new Date("2026-04-13T14:00:00Z"),
        new Date("2026-04-13T14:30:00Z"),
      ),
    ).rejects.toThrow("No in-domain reviewer available");
  });
});

// ─── reassignReviewer ───────────────────────────────────────────────────────

describe("reassignReviewer", () => {
  it("replaces a declined reviewer with the next best candidate", async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewAssignment: {
          findUnique: vi.fn().mockResolvedValue({
            id: "a1",
            role: "InDomain",
            cycleReviewer: { id: "r1", domainId: "domain1" },
            interview: {
              id: "int1",
              applicationId: "app1",
              applicationCycleId: "cycle1",
              startTime: new Date("2026-04-13T14:00:00Z"),
              endTime: new Date("2026-04-13T14:30:00Z"),
              assignments: [
                { cycleReviewerId: "r1" },
                { cycleReviewerId: "r3" },
              ],
            },
          }),
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({ cycleReviewerId: "r2" }),
        },
        interviewConfig: {
          findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }),
        },
        application: {
          findUnique: vi.fn().mockResolvedValue({
            domainApplications: [
              { challengeVersion: { domainId: "domain1" } },
            ],
          }),
        },
        cycleReviewer: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "r2",
              domainId: "domain1",
              availabilityBlocks: [
                { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
              ],
              interviewAssignments: [],
            },
          ]),
        },
        interview: {
          update: vi.fn(),
        },
      };
      return fn(tx);
    });

    const result = await reassignReviewer("int1", "a1");
    expect(result.reassigned).toBe(true);
    expect(result.newReviewerId).toBe("r2");
  });

  it("marks interview as NeedsReassignment when no replacement found", async () => {
    const mockInterviewUpdate = vi.fn().mockResolvedValue({});

    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewAssignment: {
          findUnique: vi.fn().mockResolvedValue({
            id: "a1",
            role: "InDomain",
            cycleReviewer: { id: "r1", domainId: "domain1" },
            interview: {
              id: "int1",
              applicationId: "app1",
              applicationCycleId: "cycle1",
              startTime: new Date("2026-04-13T14:00:00Z"),
              endTime: new Date("2026-04-13T14:30:00Z"),
              assignments: [{ cycleReviewerId: "r1" }],
            },
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        interviewConfig: {
          findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }),
        },
        application: {
          findUnique: vi.fn().mockResolvedValue({
            domainApplications: [
              { challengeVersion: { domainId: "domain1" } },
            ],
          }),
        },
        cycleReviewer: {
          findMany: vi.fn().mockResolvedValue([]), // no candidates
        },
        interview: {
          update: mockInterviewUpdate,
        },
      };
      return fn(tx);
    });

    const result = await reassignReviewer("int1", "a1");
    expect(result.reassigned).toBe(false);
    expect(result.newReviewerId).toBeNull();
  });

  it("throws when assignment not found", async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewAssignment: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };
      return fn(tx);
    });

    await expect(reassignReviewer("int1", "missing")).rejects.toThrow("Assignment not found");
  });
});
