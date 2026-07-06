import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn() }));
vi.mock("~/projects/lib/staffing-cycle", () => ({
  ensureStaffingCycle: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { ensureStaffingCycle } from "~/projects/lib/staffing-cycle";
import { listMemberStaffingForms } from "~/projects/lib/member-staffing.server";

const mockPrisma = prisma as unknown as {
  staffingCycleFormBinding: { findUnique: ReturnType<typeof vi.fn> };
  formSubmission: { findFirst: ReturnType<typeof vi.fn> };
};
const mockCurrentTerm = currentTerm as unknown as ReturnType<typeof vi.fn>;
const mockEnsure = ensureStaffingCycle as unknown as ReturnType<typeof vi.fn>;

function bindingRow(opts: {
  formId: string;
  name?: string;
  published?: boolean;
  publicToken?: string | null;
}) {
  return {
    updatedAt: new Date("2026-01-01"),
    columnMapping: null,
    form: {
      id: opts.formId,
      name: opts.name ?? "Intent Form",
      published: opts.published ?? true,
      publicToken: opts.publicToken === undefined ? "tok" : opts.publicToken,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).staffingCycleFormBinding = { findUnique: vi.fn() };
  (mockPrisma as any).formSubmission = { findFirst: vi.fn() };
  mockCurrentTerm.mockResolvedValue({ id: "t1", code: "26S" });
  mockEnsure.mockResolvedValue({ id: "cycle-1" });
});

describe("listMemberStaffingForms", () => {
  it("returns [] when there is no current term", async () => {
    mockCurrentTerm.mockResolvedValue(null);
    expect(await listMemberStaffingForms("u1")).toEqual([]);
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it("published+bound slot with no submission → submitted false", async () => {
    // Only intent-to-work bound; the other two slots resolve to null.
    mockPrisma.staffingCycleFormBinding.findUnique.mockImplementation(
      ({ where }: any) =>
        where.staffingCycleId_slot.slot === "intent-to-work"
          ? bindingRow({ formId: "f1" })
          : null,
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
    mockPrisma.staffingCycleFormBinding.findUnique.mockImplementation(
      ({ where }: any) =>
        where.staffingCycleId_slot.slot === "intent-to-work"
          ? bindingRow({ formId: "f1" })
          : null,
    );
    mockPrisma.formSubmission.findFirst.mockResolvedValue({
      createdAt: new Date("2026-02-03T04:05:06.000Z"),
    });

    const out = await listMemberStaffingForms("u1");
    expect(out[0].submitted).toBe(true);
    expect(out[0].submittedAt).toBe("2026-02-03T04:05:06.000Z");
  });

  it("omits unpublished or token-less bindings", async () => {
    mockPrisma.staffingCycleFormBinding.findUnique.mockImplementation(
      ({ where }: any) => {
        const slot = where.staffingCycleId_slot.slot;
        if (slot === "intent-to-work")
          return bindingRow({ formId: "f1", published: false });
        if (slot === "project-bids")
          return bindingRow({ formId: "f2", publicToken: null });
        return null;
      },
    );
    mockPrisma.formSubmission.findFirst.mockResolvedValue(null);

    expect(await listMemberStaffingForms("u1")).toEqual([]);
    // No submission lookups for slots that were filtered out.
    expect(mockPrisma.formSubmission.findFirst).not.toHaveBeenCalled();
  });

  it("scopes the submission lookup to the requesting user", async () => {
    mockPrisma.staffingCycleFormBinding.findUnique.mockImplementation(
      ({ where }: any) =>
        where.staffingCycleId_slot.slot === "intent-to-work"
          ? bindingRow({ formId: "f1" })
          : null,
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
