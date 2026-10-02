import { describe, it, expect, vi } from "vitest";
// form-slots.ts imports the real ~/lib/db at module load (for other helpers);
// stub it so importing this pure function doesn't pull in the generated Prisma
// client, which isn't built during the unit-test CI job. pickStaffingBinding
// never touches prisma, so the mock is inert.
vi.mock("~/lib/db");
import {
  pickStaffingBinding,
  isGateAudience,
  setSlotGate,
  setSlotBinding,
} from "~/projects/lib/form-slots";
import { prisma } from "~/lib/db";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

// Shape mirrors the subset of StaffingCycleFormBinding that submitMemberForm
// selects on. Dates are explicit so the tie-break order is unambiguous.
function binding(opts: {
  slot: string;
  termId: string;
  updatedAt: string;
  id?: string;
}) {
  return {
    id: opts.id ?? `${opts.slot}-${opts.termId}`,
    slot: opts.slot,
    termId: opts.termId,
    updatedAt: new Date(opts.updatedAt),
    staffingCycle: { termId: opts.termId },
  };
}

describe("pickStaffingBinding", () => {
  it("returns undefined when the form drives no staffing slot", () => {
    const bindings = [
      binding({ slot: "some-other-slot", termId: "t-26S", updatedAt: "2026-01-01" }),
    ];
    expect(pickStaffingBinding(bindings, "t-26S")).toBeUndefined();
  });

  it("picks the form's bound cycle even when it isn't the current term", () => {
    // The regression: a 26S bid form submitted while the calendar's current
    // term is 26W must still feed 26S, not get dropped for a missing live
    // binding.
    const bindings = [
      binding({ slot: "project-bids", termId: "t-26S", updatedAt: "2026-01-01" }),
    ];
    const picked = pickStaffingBinding(bindings, "t-26W");
    expect(picked?.termId).toBe("t-26S");
  });

  it("prefers the live term's binding when a form is reused across cycles", () => {
    const bindings = [
      binding({ slot: "project-bids", termId: "t-26S", updatedAt: "2026-03-01" }),
      binding({ slot: "project-bids", termId: "t-26W", updatedAt: "2026-01-01" }),
    ];
    // 26S is newer, but 26W is live — live wins.
    const picked = pickStaffingBinding(bindings, "t-26W");
    expect(picked?.termId).toBe("t-26W");
  });

  it("falls back to the most recently updated binding when none is live", () => {
    const bindings = [
      binding({ slot: "project-bids", termId: "t-26S", updatedAt: "2026-03-01" }),
      binding({ slot: "project-bids", termId: "t-26W", updatedAt: "2026-01-01" }),
    ];
    // currentTerm() is null (between terms) → newest binding wins.
    const picked = pickStaffingBinding(bindings, null);
    expect(picked?.termId).toBe("t-26S");
  });

  it("considers intent-to-work bindings too, ignoring unrelated slots", () => {
    const bindings = [
      binding({ slot: "some-other-slot", termId: "t-26S", updatedAt: "2026-05-01" }),
      binding({ slot: "intent-to-work", termId: "t-26W", updatedAt: "2026-01-01" }),
    ];
    const picked = pickStaffingBinding(bindings, null);
    expect(picked?.slot).toBe("intent-to-work");
  });
});

describe("isGateAudience", () => {
  it("accepts the gate-audience subset and rejects everything else", () => {
    expect(isGateAudience("Members")).toBe(true);
    expect(isGateAudience("Group")).toBe(true);
    // Excluded from the staffing app-lock even though they're valid signing
    // audiences.
    expect(isGateAudience("Manual")).toBe(false);
    expect(isGateAudience("HiringParticipants")).toBe(false);
    expect(isGateAudience("nonsense")).toBe(false);
  });
});

describe("setSlotBinding", () => {
  it("clears the slot when no form is selected", async () => {
    vi.resetAllMocks();
    mockPrisma.staffingCycleFormBinding.deleteMany.mockResolvedValue({ count: 1 });
    const result = await setSlotBinding("cyc-26F", "intent-to-work", "", "u-1");
    expect(result.ok).toBe(true);
    expect(mockPrisma.staffingCycleFormBinding.deleteMany).toHaveBeenCalledWith({
      where: { staffingCycleId: "cyc-26F", slot: "intent-to-work" },
    });
    expect(mockPrisma.staffingCycleFormBinding.upsert).not.toHaveBeenCalled();
  });

  it("refuses to bind a form that already feeds another cycle", async () => {
    vi.resetAllMocks();
    mockPrisma.form.findUnique.mockResolvedValue({ id: "f-1" });
    mockPrisma.staffingCycleFormBinding.findFirst.mockResolvedValue({
      slot: "intent-to-work",
      staffingCycle: { term: { code: "27W" } },
    });
    const result = await setSlotBinding("cyc-26F", "intent-to-work", "f-1", "u-1");
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("27W Intent to Work"),
    });
    expect(mockPrisma.staffingCycleFormBinding.upsert).not.toHaveBeenCalled();
  });

  it("binds when the form feeds no other cycle", async () => {
    vi.resetAllMocks();
    mockPrisma.form.findUnique.mockResolvedValue({ id: "f-1" });
    mockPrisma.staffingCycleFormBinding.findFirst.mockResolvedValue(null);
    mockPrisma.staffingCycleFormBinding.upsert.mockResolvedValue({});
    const result = await setSlotBinding("cyc-27W", "intent-to-work", "f-1", "u-1");
    expect(result.ok).toBe(true);
    expect(mockPrisma.staffingCycleFormBinding.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          formId: "f-1",
          NOT: { staffingCycleId: "cyc-27W", slot: "intent-to-work" },
        }),
      }),
    );
    expect(mockPrisma.staffingCycleFormBinding.upsert).toHaveBeenCalled();
  });
});

describe("setSlotGate", () => {
  it("errors when no form is bound to the slot yet", async () => {
    vi.resetAllMocks();
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue(null);
    const result = await setSlotGate("cyc-1", "intent-to-work", "Members", null, "u-1");
    expect(result.ok).toBe(false);
    expect(mockPrisma.staffingCycleFormBinding.update).not.toHaveBeenCalled();
  });

  it("clears gateAudienceGroupId for a non-Group audience", async () => {
    vi.resetAllMocks();
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue({ id: "b-1" });
    mockPrisma.staffingCycleFormBinding.update.mockResolvedValue({});
    const result = await setSlotGate("cyc-1", "project-bids", "Members", "grp-1", "u-1");
    expect(result.ok).toBe(true);
    expect(mockPrisma.staffingCycleFormBinding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gateAudience: "Members",
          gateAudienceGroupId: null,
        }),
      }),
    );
  });

  it("keeps the group id for a Group audience, and null audience turns the lock off", async () => {
    vi.resetAllMocks();
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue({ id: "b-1" });
    mockPrisma.staffingCycleFormBinding.update.mockResolvedValue({});

    await setSlotGate("cyc-1", "project-bids", "Group", "grp-1", "u-1");
    expect(mockPrisma.staffingCycleFormBinding.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gateAudience: "Group",
          gateAudienceGroupId: "grp-1",
        }),
      }),
    );

    await setSlotGate("cyc-1", "project-bids", null, null, "u-1");
    expect(mockPrisma.staffingCycleFormBinding.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gateAudience: null,
          gateAudienceGroupId: null,
        }),
      }),
    );
  });
});
