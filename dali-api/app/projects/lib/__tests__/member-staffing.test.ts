import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { listMemberStaffingForms } from "~/projects/lib/member-staffing.server";

const mockPrisma = prisma as unknown as {
  staffingCycleFormBinding: { findFirst: ReturnType<typeof vi.fn> };
  formSubmission: { findFirst: ReturnType<typeof vi.fn> };
};

function bindingRow(opts: {
  cycleId?: string;
  name?: string;
  publicToken?: string | null;
}) {
  return {
    staffingCycleId: opts.cycleId ?? "cycle-1",
    form: {
      name: opts.name ?? "Intent Form",
      publicToken: opts.publicToken === undefined ? "tok" : opts.publicToken,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).staffingCycleFormBinding = { findFirst: vi.fn() };
  (mockPrisma as any).formSubmission = { findFirst: vi.fn() };
});

describe("listMemberStaffingForms", () => {
  it("returns [] when no slot has a published, fillable binding", async () => {
    mockPrisma.staffingCycleFormBinding.findFirst.mockResolvedValue(null);
    expect(await listMemberStaffingForms("u1")).toEqual([]);
    expect(mockPrisma.formSubmission.findFirst).not.toHaveBeenCalled();
  });

  it("published+bound slot with no submission → submitted false", async () => {
    // Only intent-to-work bound; the other two slots resolve to null.
    mockPrisma.staffingCycleFormBinding.findFirst.mockImplementation(
      ({ where }: any) =>
        where.slot === "intent-to-work" ? bindingRow({}) : null,
    );
    mockPrisma.formSubmission.findFirst.mockResolvedValue(null);

    const out = await listMemberStaffingForms("u1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      slot: "intent-to-work",
      slotLabel: "Intent to Work",
      formName: "Intent Form",
      fillLink: "/forms/fill/tok",
      submitted: false,
      submittedAt: null,
    });
  });

  it("a submission → submitted true with ISO submittedAt", async () => {
    mockPrisma.staffingCycleFormBinding.findFirst.mockImplementation(
      ({ where }: any) =>
        where.slot === "intent-to-work" ? bindingRow({}) : null,
    );
    mockPrisma.formSubmission.findFirst.mockResolvedValue({
      createdAt: new Date("2026-02-03T04:05:06.000Z"),
    });

    const out = await listMemberStaffingForms("u1");
    expect(out[0].submitted).toBe(true);
    expect(out[0].submittedAt).toBe("2026-02-03T04:05:06.000Z");
  });

  it("only considers published bindings whose form is fillable", async () => {
    mockPrisma.staffingCycleFormBinding.findFirst.mockResolvedValue(null);
    await listMemberStaffingForms("u1");

    for (const call of mockPrisma.staffingCycleFormBinding.findFirst.mock.calls) {
      expect(call[0].where.form).toEqual({
        published: true,
        publicToken: { not: null },
      });
    }
  });

  it("omits a binding whose form has no public token", async () => {
    mockPrisma.staffingCycleFormBinding.findFirst.mockImplementation(
      ({ where }: any) =>
        where.slot === "project-bids"
          ? bindingRow({ publicToken: null })
          : null,
    );
    mockPrisma.formSubmission.findFirst.mockResolvedValue(null);

    expect(await listMemberStaffingForms("u1")).toEqual([]);
    expect(mockPrisma.formSubmission.findFirst).not.toHaveBeenCalled();
  });

  // The regression this function exists to avoid: bidding for term N+1 runs
  // during term N, so the round must come from the newest binding, never from
  // the calendar's current term.
  it("picks the newest binding, and counts submissions against ITS cycle", async () => {
    mockPrisma.staffingCycleFormBinding.findFirst.mockImplementation(
      ({ where }: any) =>
        where.slot === "project-bids"
          ? bindingRow({ cycleId: "cycle-26F", name: "Project Bids Form 26F" })
          : null,
    );
    mockPrisma.formSubmission.findFirst.mockResolvedValue({
      createdAt: new Date("2026-08-16T00:00:00.000Z"),
    });

    const out = await listMemberStaffingForms("u1");
    expect(out[0].formName).toBe("Project Bids Form 26F");
    expect(
      mockPrisma.staffingCycleFormBinding.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: "desc" } }),
    );
    expect(mockPrisma.formSubmission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ staffingCycleId: "cycle-26F" }),
      }),
    );
  });

  it("scopes the submission lookup to the requesting user", async () => {
    mockPrisma.staffingCycleFormBinding.findFirst.mockImplementation(
      ({ where }: any) =>
        where.slot === "intent-to-work" ? bindingRow({}) : null,
    );
    mockPrisma.formSubmission.findFirst.mockResolvedValue(null);

    await listMemberStaffingForms("u-me");
    expect(mockPrisma.formSubmission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "u-me", slot: "intent-to-work" }),
      }),
    );
  });
});
