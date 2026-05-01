import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  isInterviewerFree,
  generateCandidateSlots,
  computeAvailableSlots,
  assignInterviewers,
  reassignInterviewer,
} from "~/hiring/lib/scheduling";

const mockPrisma = prisma as unknown as {
  interviewConfig: { findUnique: ReturnType<typeof vi.fn> };
  cycleInterviewer: { findMany: ReturnType<typeof vi.fn> };
  interviewAssignment: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  interview: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  // Ensure nested model accessors exist on the auto-mock
  if (!mockPrisma.interviewConfig) (mockPrisma as any).interviewConfig = { findUnique: vi.fn() };
  if (!mockPrisma.cycleInterviewer) (mockPrisma as any).cycleInterviewer = { findMany: vi.fn() };
  if (!mockPrisma.interviewAssignment)
    (mockPrisma as any).interviewAssignment = {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
  if (!mockPrisma.interview) (mockPrisma as any).interview = { create: vi.fn(), update: vi.fn() };
  if (!mockPrisma.$transaction) (mockPrisma as any).$transaction = vi.fn();
});

// ─── isInterviewerFree ─────────────────────────────────────────────────────────

describe("isInterviewerFree", () => {
  const slotStart = new Date("2026-04-15T14:00:00Z");
  const slotEnd = new Date("2026-04-15T14:30:00Z");

  it("returns true when availability covers slot and no conflicts", () => {
    const reviewer = {
      cycleInterviewerId: "r1",
      daliMemberId: "m1",
      domainId: "d1",
      availability: [
        { startTime: new Date("2026-04-15T13:00:00Z"), endTime: new Date("2026-04-15T17:00:00Z") },
      ],
      bookedIntervals: [],
    };
    expect(isInterviewerFree(reviewer, slotStart, slotEnd)).toBe(true);
  });

  it("returns false when no availability block covers the slot", () => {
    const reviewer = {
      cycleInterviewerId: "r1",
      daliMemberId: "m1",
      domainId: "d1",
      availability: [
        { startTime: new Date("2026-04-15T15:00:00Z"), endTime: new Date("2026-04-15T17:00:00Z") },
      ],
      bookedIntervals: [],
    };
    expect(isInterviewerFree(reviewer, slotStart, slotEnd)).toBe(false);
  });

  it("returns false when availability only partially covers the slot", () => {
    const reviewer = {
      cycleInterviewerId: "r1",
      daliMemberId: "m1",
      domainId: "d1",
      availability: [
        { startTime: new Date("2026-04-15T14:00:00Z"), endTime: new Date("2026-04-15T14:20:00Z") },
      ],
      bookedIntervals: [],
    };
    expect(isInterviewerFree(reviewer, slotStart, slotEnd)).toBe(false);
  });

  it("returns false when a booked interval overlaps the slot", () => {
    const reviewer = {
      cycleInterviewerId: "r1",
      daliMemberId: "m1",
      domainId: "d1",
      availability: [
        { startTime: new Date("2026-04-15T13:00:00Z"), endTime: new Date("2026-04-15T17:00:00Z") },
      ],
      bookedIntervals: [
        { start: new Date("2026-04-15T14:15:00Z"), end: new Date("2026-04-15T15:00:00Z") },
      ],
    };
    expect(isInterviewerFree(reviewer, slotStart, slotEnd)).toBe(false);
  });

  it("returns true when booked interval ends exactly at slot start (no overlap)", () => {
    const reviewer = {
      cycleInterviewerId: "r1",
      daliMemberId: "m1",
      domainId: "d1",
      availability: [
        { startTime: new Date("2026-04-15T13:00:00Z"), endTime: new Date("2026-04-15T17:00:00Z") },
      ],
      bookedIntervals: [
        { start: new Date("2026-04-15T13:00:00Z"), end: new Date("2026-04-15T14:00:00Z") },
      ],
    };
    expect(isInterviewerFree(reviewer, slotStart, slotEnd)).toBe(true);
  });

  it("returns true when booked interval starts exactly at slot end (no overlap)", () => {
    const reviewer = {
      cycleInterviewerId: "r1",
      daliMemberId: "m1",
      domainId: "d1",
      availability: [
        { startTime: new Date("2026-04-15T13:00:00Z"), endTime: new Date("2026-04-15T17:00:00Z") },
      ],
      bookedIntervals: [
        { start: new Date("2026-04-15T14:30:00Z"), end: new Date("2026-04-15T15:30:00Z") },
      ],
    };
    expect(isInterviewerFree(reviewer, slotStart, slotEnd)).toBe(true);
  });

  it("returns false with empty availability", () => {
    const reviewer = {
      cycleInterviewerId: "r1",
      daliMemberId: "m1",
      domainId: "d1",
      availability: [],
      bookedIntervals: [],
    };
    expect(isInterviewerFree(reviewer, slotStart, slotEnd)).toBe(false);
  });
});

// ─── generateCandidateSlots ─────────────────────────────────────────────────

describe("generateCandidateSlots", () => {
  // No fake timers — they break Intl.DateTimeFormat timezone handling.
  // Use dates far in the future so the "slotStart > new Date()" filter passes.

  // NOTE: start/end dates use T04:00:00Z (midnight EDT) so that
  // toLocaleDateString("en-CA", { timeZone: "America/New_York" }) resolves
  // to the intended calendar day (midnight UTC is still the previous evening in ET).

  it("generates slots within business hours on weekdays", () => {
    const start = new Date("2030-04-15T04:00:00Z"); // Monday midnight ET
    const end = new Date("2030-04-16T03:59:59Z");

    const slots = generateCandidateSlots(start, end, 9, 10, 30, "America/New_York");

    expect(slots.length).toBeGreaterThan(0);

    for (const slot of slots) {
      const localDay = new Date(slot.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
      expect(localDay).not.toBe(0); // not Sunday
      expect(localDay).not.toBe(6); // not Saturday
    }
  });

  it("skips weekends", () => {
    const start = new Date("2030-04-20T04:00:00Z"); // Saturday midnight ET
    const end = new Date("2030-04-22T03:59:59Z");   // through Sunday

    const slots = generateCandidateSlots(start, end, 9, 17, 30, "America/New_York");
    expect(slots).toHaveLength(0);
  });

  it("generates slots at 15-minute increments", () => {
    const start = new Date("2030-04-15T04:00:00Z"); // Monday midnight ET
    const end = new Date("2030-04-16T03:59:59Z");

    const slots = generateCandidateSlots(start, end, 9, 18, 30, "America/New_York");
    expect(slots.length).toBeGreaterThan(1);

    for (let i = 1; i < slots.length; i++) {
      const diff = slots[i].getTime() - slots[i - 1].getTime();
      expect(diff).toBe(15 * 60_000);
    }
  });

  it("does not generate slots that end after dayEndHour", () => {
    const start = new Date("2030-04-15T04:00:00Z"); // Monday midnight ET
    const end = new Date("2030-04-16T03:59:59Z");

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
    const start = new Date("2030-04-15T04:00:00Z"); // Monday midnight ET
    const end = new Date("2030-04-17T03:59:59Z");   // through Tuesday

    const slots = generateCandidateSlots(start, end, 9, 18, 30, "America/New_York");

    const days = new Set(slots.map((s) =>
      new Date(s.toLocaleString("en-US", { timeZone: "America/New_York" })).getDate()
    ));
    expect(days.size).toBe(2);
  });
});

// ─── computeAvailableSlots ──────────────────────────────────────────────────

describe("computeAvailableSlots", () => {
  // No fake timers — vi.useFakeTimers() breaks Intl.DateTimeFormat timezone
  // handling which parseTzDateTime depends on. Use dates far in the future
  // so the "slotStart > new Date()" filter always passes.

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
      interviewStartDate: new Date("2030-04-15T04:00:00Z"), // Monday midnight ET
      interviewEndDate: new Date("2030-04-16T03:59:59Z"),
      timezone: "America/New_York",
    });

    // One in-domain reviewer, one cross-domain reviewer, both available all day
    mockPrisma.cycleInterviewer.findMany.mockResolvedValue([
      {
        id: "r1",
        daliMemberId: "m1",
        domainId: "domain1",
        availabilityBlocks: [
          { startTime: new Date("2030-04-15T00:00:00Z"), endTime: new Date("2030-04-15T23:59:59Z") },
        ],
        interviewAssignments: [],
      },
      {
        id: "r2",
        daliMemberId: "m2",
        domainId: "domain-other",
        availabilityBlocks: [
          { startTime: new Date("2030-04-15T00:00:00Z"), endTime: new Date("2030-04-15T23:59:59Z") },
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
      interviewStartDate: new Date("2030-04-15T04:00:00Z"),
      interviewEndDate: new Date("2030-04-16T03:59:59Z"),
      timezone: "America/New_York",
    });

    // Only in-domain reviewers, no cross-domain
    mockPrisma.cycleInterviewer.findMany.mockResolvedValue([
      {
        id: "r1",
        daliMemberId: "m1",
        domainId: "domain1",
        availabilityBlocks: [
          { startTime: new Date("2030-04-15T00:00:00Z"), endTime: new Date("2030-04-15T23:59:59Z") },
        ],
        interviewAssignments: [],
      },
    ]);

    const slots = await computeAvailableSlots("cycle1", ["domain1"]);
    expect(slots).toEqual([]);
  });

  it("treats a cross-row conflict as a member-level conflict (Mira double-book)", async () => {
    mockPrisma.interviewConfig.findUnique.mockResolvedValue({
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      dayStartHour: 9,
      dayEndHour: 10,
      interviewStartDate: new Date("2030-04-15T04:00:00Z"),
      interviewEndDate: new Date("2030-04-16T03:59:59Z"),
      timezone: "America/New_York",
    });

    // Mira has two rows (Eng + Design). Her Eng row holds a 9:00 interview.
    // Her Design row has no assignments, but member-level aggregation should
    // treat her as busy at 9:00 for cross-domain purposes too. With a
    // single-domain cross-domain peer absent, there should be no available
    // slot at 9:00 — only at 9:30 (after the conflict clears).
    mockPrisma.cycleInterviewer.findMany.mockResolvedValue([
      {
        id: "r-mira-eng",
        daliMemberId: "mira",
        domainId: "domain1",
        availabilityBlocks: [
          { startTime: new Date("2030-04-15T00:00:00Z"), endTime: new Date("2030-04-15T23:59:59Z") },
        ],
        interviewAssignments: [
          {
            interview: {
              startTime: new Date("2030-04-15T13:00:00Z"), // 9:00 EDT
              endTime: new Date("2030-04-15T13:30:00Z"),
            },
          },
        ],
      },
      {
        id: "r-mira-design",
        daliMemberId: "mira", // same member
        domainId: "domain-other",
        availabilityBlocks: [
          { startTime: new Date("2030-04-15T00:00:00Z"), endTime: new Date("2030-04-15T23:59:59Z") },
        ],
        interviewAssignments: [], // empty at the row level
      },
      {
        id: "r-bob",
        daliMemberId: "bob",
        domainId: "domain1",
        availabilityBlocks: [
          { startTime: new Date("2030-04-15T00:00:00Z"), endTime: new Date("2030-04-15T23:59:59Z") },
        ],
        interviewAssignments: [],
      },
    ]);

    // Need an in-domain interviewer for domain1 (Bob or Mira-eng) AND a
    // cross-domain interviewer for domain-other (only Mira-design). At 9:00
    // Mira is busy under her Eng row, and member-level aggregation should
    // propagate that to her Design row — no slot.
    const slots = await computeAvailableSlots("cycle1", ["domain1"]);
    const at9 = slots.find((s) => s.startTime === new Date("2030-04-15T13:00:00Z").toISOString());
    expect(at9).toBeUndefined();
    // 9:30 should still work — Mira is free by then.
    const at930 = slots.find((s) => s.startTime === new Date("2030-04-15T13:30:00Z").toISOString());
    expect(at930).toBeDefined();
  });
});

// ─── assignInterviewers ────────────────────────────────────────────────────────

describe("assignInterviewers", () => {
  it("picks the least-scheduled reviewers and creates an interview", async () => {
    const createdInterview = {
      id: "int1",
      applicationId: "app1",
      applicationCycleId: "cycle1",
      startTime: new Date("2026-04-13T14:00:00Z"),
      endTime: new Date("2026-04-13T14:30:00Z"),
      status: "Scheduled",
      assignments: [
        { cycleInterviewerId: "r1", role: "InDomain", status: "Active" },
        { cycleInterviewerId: "r2", role: "CrossDomain", status: "Active" },
      ],
    };

    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const fullInterviewers = [
        {
          id: "r1",
          daliMemberId: "m1",
          domainId: "domain1",
          availabilityBlocks: [
            { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
          ],
          interviewAssignments: [
            { interview: { startTime: new Date("2026-04-12T10:00:00Z"), endTime: new Date("2026-04-12T10:30:00Z") } },
          ],
        },
        {
          id: "r1-busy",
          daliMemberId: "m-busy",
          domainId: "domain1",
          availabilityBlocks: [
            { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
          ],
          interviewAssignments: [
            { interview: { startTime: new Date("2026-04-12T10:00:00Z"), endTime: new Date("2026-04-12T10:30:00Z") } },
            { interview: { startTime: new Date("2026-04-12T11:00:00Z"), endTime: new Date("2026-04-12T11:30:00Z") } },
            { interview: { startTime: new Date("2026-04-12T12:00:00Z"), endTime: new Date("2026-04-12T12:30:00Z") } },
          ],
        },
        {
          id: "r2",
          daliMemberId: "m2",
          domainId: "domain-other",
          availabilityBlocks: [
            { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
          ],
          interviewAssignments: [],
        },
      ];
      const findManyMock = vi.fn()
        .mockResolvedValueOnce(fullInterviewers.map((i) => ({ id: i.id })))
        .mockResolvedValueOnce(fullInterviewers);
      const tx = {
        interviewConfig: {
          findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }),
        },
        cycleInterviewer: { findMany: findManyMock },
        interview: {
          create: vi.fn().mockResolvedValue(createdInterview),
        },
        $executeRaw: vi.fn().mockResolvedValue(0),
      };
      return fn(tx);
    });

    const result = await assignInterviewers(
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
      assignInterviewers("cycle1", "app1", ["domain1"], new Date(), new Date()),
    ).rejects.toThrow("No interview config for this cycle");
  });

  it("throws a clear error when the cycle has no interviewers configured", async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewConfig: { findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }) },
        cycleInterviewer: {
          findMany: vi.fn().mockResolvedValueOnce([]),
        },
        $executeRaw: vi.fn().mockResolvedValue(0),
      };
      return fn(tx);
    });

    await expect(
      assignInterviewers(
        "cycle1",
        "app1",
        ["domain1"],
        new Date("2026-04-13T14:00:00Z"),
        new Date("2026-04-13T14:30:00Z"),
      ),
    ).rejects.toThrow("No interviewers have been configured for this cycle. Contact the hiring lead.");
  });

  it("throws when no in-domain reviewer is available", async () => {
    const onlyCrossDomain = [
      {
        id: "r2",
        daliMemberId: "m2",
        domainId: "domain-other",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
        ],
        interviewAssignments: [],
      },
    ];
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewConfig: { findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }) },
        cycleInterviewer: {
          findMany: vi.fn()
            .mockResolvedValueOnce(onlyCrossDomain.map((i) => ({ id: i.id })))
            .mockResolvedValueOnce(onlyCrossDomain),
        },
        $executeRaw: vi.fn().mockResolvedValue(0),
      };
      return fn(tx);
    });

    await expect(
      assignInterviewers(
        "cycle1", "app1", ["domain1"],
        new Date("2026-04-13T14:00:00Z"),
        new Date("2026-04-13T14:30:00Z"),
      ),
    ).rejects.toThrow("No in-domain interviewer available");
  });

  it("does not place the same human in both in-domain and cross-domain seats", async () => {
    // Mira is the only in-domain candidate (domain1) and also appears under a
    // Design row (domain-other). Without Fix A, the scheduler would pick
    // Mira-eng as in-domain AND Mira-design as cross-domain. Fix A rejects
    // this by excluding Mira's daliMemberId from the cross-domain pool —
    // and since she's the only cross-domain option, the booking must fail.
    const twoMiraRows = [
      {
        id: "r-mira-eng",
        daliMemberId: "mira",
        domainId: "domain1",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
        ],
        interviewAssignments: [],
      },
      {
        id: "r-mira-design",
        daliMemberId: "mira",
        domainId: "domain-other",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
        ],
        interviewAssignments: [],
      },
    ];
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewConfig: { findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }) },
        cycleInterviewer: {
          findMany: vi
            .fn()
            .mockResolvedValueOnce(twoMiraRows.map((i) => ({ id: i.id })))
            .mockResolvedValueOnce(twoMiraRows),
        },
        $executeRaw: vi.fn().mockResolvedValue(0),
      };
      return fn(tx);
    });

    await expect(
      assignInterviewers(
        "cycle1",
        "app1",
        ["domain1"],
        new Date("2026-04-13T14:00:00Z"),
        new Date("2026-04-13T14:30:00Z"),
      ),
    ).rejects.toThrow("No cross-domain interviewer available");
  });

  it("load-balances per human, not per row, when a member spans two domains", async () => {
    // Mira has two rows. Her Eng row already holds 3 past interviews. Bob has
    // one. For a new Eng applicant, per-row counting would tie-break Mira-eng
    // (count=3) against Bob-eng (count=1) and pick Bob. Per-human counting
    // sees Mira total = 3 and Bob total = 1 — same outcome, but member-level
    // counting ensures we don't get fooled by split totals.
    const capturedCreate = vi.fn().mockImplementation((args) => ({
      id: "int1",
      ...args.data,
      assignments: args.data.assignments.create.map((a: any, idx: number) => ({ id: `a${idx}`, ...a })),
    }));
    const interviewers = [
      {
        id: "r-mira-eng",
        daliMemberId: "mira",
        domainId: "domain1",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
        ],
        interviewAssignments: [
          { interview: { startTime: new Date("2026-04-10T10:00:00Z"), endTime: new Date("2026-04-10T10:30:00Z") } },
          { interview: { startTime: new Date("2026-04-10T11:00:00Z"), endTime: new Date("2026-04-10T11:30:00Z") } },
          { interview: { startTime: new Date("2026-04-10T12:00:00Z"), endTime: new Date("2026-04-10T12:30:00Z") } },
        ],
      },
      {
        id: "r-bob",
        daliMemberId: "bob",
        domainId: "domain1",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
        ],
        interviewAssignments: [
          { interview: { startTime: new Date("2026-04-10T10:00:00Z"), endTime: new Date("2026-04-10T10:30:00Z") } },
        ],
      },
      {
        id: "r-cross",
        daliMemberId: "pat",
        domainId: "domain-other",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
        ],
        interviewAssignments: [],
      },
    ];
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewConfig: { findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }) },
        cycleInterviewer: {
          findMany: vi.fn()
            .mockResolvedValueOnce(interviewers.map((i) => ({ id: i.id })))
            .mockResolvedValueOnce(interviewers),
        },
        interview: { create: capturedCreate },
        $executeRaw: vi.fn().mockResolvedValue(0),
      };
      return fn(tx);
    });

    await assignInterviewers(
      "cycle1", "app1", ["domain1"],
      new Date("2026-04-13T14:00:00Z"),
      new Date("2026-04-13T14:30:00Z"),
    );

    // Pick should be Bob (count=1), not Mira (count=3)
    const createArgs = capturedCreate.mock.calls[0][0];
    const inDomain = createArgs.data.assignments.create.find((a: any) => a.role === "InDomain");
    expect(inDomain.cycleInterviewerId).toBe("r-bob");
  });

  // Regression for #258: a constraint failure inside the nested
  // interview.create write must propagate so the surrounding $transaction rolls
  // back, leaving no Interview row behind. The function must not attempt any
  // compensating cleanup writes — rollback handles it.
  it("rejects and performs no compensating writes when interview.create fails", async () => {
    const interviewers = [
      {
        id: "r1",
        daliMemberId: "m1",
        domainId: "domain1",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
        ],
        interviewAssignments: [],
      },
      {
        id: "r2",
        daliMemberId: "m2",
        domainId: "domain-other",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
        ],
        interviewAssignments: [],
      },
    ];
    const interviewCreate = vi.fn().mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    const interviewUpdate = vi.fn();
    const assignmentCreate = vi.fn();
    const assignmentUpdate = vi.fn();
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewConfig: { findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }) },
        cycleInterviewer: {
          findMany: vi.fn()
            .mockResolvedValueOnce(interviewers.map((i) => ({ id: i.id })))
            .mockResolvedValueOnce(interviewers),
        },
        interview: { create: interviewCreate, update: interviewUpdate },
        interviewAssignment: { create: assignmentCreate, update: assignmentUpdate },
        $executeRaw: vi.fn().mockResolvedValue(0),
      };
      return fn(tx);
    });

    await expect(
      assignInterviewers(
        "cycle1",
        "app1",
        ["domain1"],
        new Date("2026-04-13T14:00:00Z"),
        new Date("2026-04-13T14:30:00Z"),
      ),
    ).rejects.toThrow("Unique constraint failed");

    expect(interviewCreate).toHaveBeenCalledTimes(1);
    expect(interviewUpdate).not.toHaveBeenCalled();
    expect(assignmentCreate).not.toHaveBeenCalled();
    expect(assignmentUpdate).not.toHaveBeenCalled();
  });

  // Defense-in-depth for #258: if a future refactor splits the nested write
  // and leaves the Interview without its two assignments, the post-create
  // length check must throw so the surrounding transaction rolls back.
  it("throws when interview.create returns fewer than two assignments", async () => {
    const interviewers = [
      {
        id: "r1",
        daliMemberId: "m1",
        domainId: "domain1",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
        ],
        interviewAssignments: [],
      },
      {
        id: "r2",
        daliMemberId: "m2",
        domainId: "domain-other",
        availabilityBlocks: [
          { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
        ],
        interviewAssignments: [],
      },
    ];
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewConfig: { findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }) },
        cycleInterviewer: {
          findMany: vi.fn()
            .mockResolvedValueOnce(interviewers.map((i) => ({ id: i.id })))
            .mockResolvedValueOnce(interviewers),
        },
        interview: {
          create: vi.fn().mockResolvedValue({
            id: "int1",
            assignments: [
              { cycleInterviewerId: "r1", role: "InDomain", status: "Active" },
            ],
          }),
        },
        $executeRaw: vi.fn().mockResolvedValue(0),
      };
      return fn(tx);
    });

    await expect(
      assignInterviewers(
        "cycle1",
        "app1",
        ["domain1"],
        new Date("2026-04-13T14:00:00Z"),
        new Date("2026-04-13T14:30:00Z"),
      ),
    ).rejects.toThrow("Interview created without expected assignments");
  });
});

// ─── reassignInterviewer ───────────────────────────────────────────────────────

describe("reassignInterviewer", () => {
  it("replaces a declined reviewer with the next best candidate", async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewAssignment: {
          findUnique: vi.fn().mockResolvedValue({
            id: "a1",
            role: "InDomain",
            cycleInterviewer: { id: "r1", daliMemberId: "m1", domainId: "domain1" },
            interview: {
              id: "int1",
              applicationCycleId: "cycle1",
              startTime: new Date("2026-04-13T14:00:00Z"),
              endTime: new Date("2026-04-13T14:30:00Z"),
              domainApplication: {
                challengeVersion: { domainId: "domain1" },
              },
              assignments: [
                { cycleInterviewerId: "r1" },
                { cycleInterviewerId: "r3" },
              ],
            },
          }),
          findMany: vi.fn().mockResolvedValue([
            { cycleInterviewer: { daliMemberId: "m1" } },
            { cycleInterviewer: { daliMemberId: "m3" } },
          ]),
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({ cycleInterviewerId: "r2" }),
        },
        interviewConfig: {
          findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }),
        },
        cycleInterviewer: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "r2",
              daliMemberId: "m2",
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

    const result = await reassignInterviewer("int1", "a1");
    expect(result.reassigned).toBe(true);
    expect(result.newInterviewerId).toBe("r2");
  });

  it("does not pick a different row for the same human as replacement", async () => {
    // Mira declines under her Design row. She also has an Eng row. The
    // reassigner filters by member id, so her Eng row must be rejected as a
    // replacement even though it's technically a different CycleInterviewer.
    // With no other candidates, the reassignment throws and the transaction
    // rolls back — the declining assignment remains Active.
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewAssignment: {
          findUnique: vi.fn().mockResolvedValue({
            id: "a1",
            role: "CrossDomain",
            cycleInterviewer: { id: "r-mira-design", daliMemberId: "mira", domainId: "domain-other" },
            interview: {
              id: "int1",
              applicationCycleId: "cycle1",
              startTime: new Date("2026-04-13T14:00:00Z"),
              endTime: new Date("2026-04-13T14:30:00Z"),
              domainApplication: {
                challengeVersion: { domainId: "domain1" },
              },
            },
          }),
          findMany: vi.fn().mockResolvedValue([
            { cycleInterviewer: { daliMemberId: "mira" } },
          ]),
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({}),
        },
        interviewConfig: {
          findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }),
        },
        cycleInterviewer: {
          findMany: vi.fn().mockResolvedValue([
            // Mira's Eng row — same human, excluded by existingMemberIds.
            {
              id: "r-mira-eng",
              daliMemberId: "mira",
              domainId: "domain1",
              availabilityBlocks: [
                { startTime: new Date("2026-04-13T13:00:00Z"), endTime: new Date("2026-04-13T17:00:00Z") },
              ],
              interviewAssignments: [],
            },
          ]),
        },
        interview: { update: vi.fn() },
      };
      return fn(tx);
    });

    await expect(reassignInterviewer("int1", "a1")).rejects.toThrow(
      "No replacement interviewer available",
    );
  });

  it("throws 'No replacement interviewer available' when no replacement found", async () => {
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const tx = {
        interviewAssignment: {
          findUnique: vi.fn().mockResolvedValue({
            id: "a1",
            role: "InDomain",
            cycleInterviewer: { id: "r1", daliMemberId: "m1", domainId: "domain1" },
            interview: {
              id: "int1",
              applicationCycleId: "cycle1",
              startTime: new Date("2026-04-13T14:00:00Z"),
              endTime: new Date("2026-04-13T14:30:00Z"),
              domainApplication: {
                challengeVersion: { domainId: "domain1" },
              },
            },
          }),
          findMany: vi.fn().mockResolvedValue([
            { cycleInterviewer: { daliMemberId: "m1" } },
          ]),
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({}),
        },
        interviewConfig: {
          findUnique: vi.fn().mockResolvedValue({ bufferMinutes: 15 }),
        },
        cycleInterviewer: {
          findMany: vi.fn().mockResolvedValue([]), // no candidates
        },
        interview: { update: vi.fn() },
      };
      return fn(tx);
    });

    await expect(reassignInterviewer("int1", "a1")).rejects.toThrow(
      "No replacement interviewer available",
    );
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

    await expect(reassignInterviewer("int1", "missing")).rejects.toThrow("Assignment not found");
  });
});
