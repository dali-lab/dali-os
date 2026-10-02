import { describe, it, expect, vi } from "vitest";
// form-slots.ts imports the real ~/lib/db at module load (for other helpers);
// stub it so importing this pure function doesn't pull in the generated Prisma
// client, which isn't built during the unit-test CI job. pickStaffingBinding
// never touches prisma, so the mock is inert.
vi.mock("~/lib/db");
import {
  pickStaffingBinding,
  boundSlotCycleIds,
  isGateAudience,
  listSelectableForms,
  setSlotBinding,
  setSlotGate,
} from "~/projects/lib/form-slots";
import { prisma } from "~/lib/db";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
> & { $transaction: ReturnType<typeof vi.fn> };

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
    staffingCycle: { id: `cyc-${opts.termId}`, termId: opts.termId },
  };
}

describe("pickStaffingBinding", () => {
  it("returns undefined when the form drives no staffing slot", () => {
    const bindings = [
      binding({ slot: "some-other-slot", termId: "t-26S", updatedAt: "2026-01-01" }),
    ];
    expect(pickStaffingBinding(bindings)).toBeUndefined();
  });

  it("picks the form's bound cycle even when it isn't the current term", () => {
    // The original regression: a 26S bid form submitted while the calendar's
    // current term is 26W must still feed 26S, not get dropped for a missing
    // live binding.
    const bindings = [
      binding({ slot: "project-bids", termId: "t-26S", updatedAt: "2026-01-01" }),
    ];
    expect(pickStaffingBinding(bindings)?.termId).toBe("t-26S");
  });

  it("breaks a multi-cycle tie on the most recent binding, not the live term", () => {
    // Intent for the next term is collected during this one, so a form bound
    // to both must follow the manager's last binding. Preferring the live term
    // is what sent 27W intent to the 26F cycle.
    const bindings = [
      binding({ slot: "intent-to-work", termId: "t-27W", updatedAt: "2026-09-29" }),
      binding({ slot: "intent-to-work", termId: "t-26F", updatedAt: "2026-09-20" }),
    ];
    expect(pickStaffingBinding(bindings)?.termId).toBe("t-27W");

    // Order of the input doesn't decide it.
    expect(pickStaffingBinding([...bindings].reverse())?.termId).toBe("t-27W");
  });

  it("considers intent-to-work bindings too, ignoring unrelated slots", () => {
    const bindings = [
      binding({ slot: "some-other-slot", termId: "t-26S", updatedAt: "2026-05-01" }),
      binding({ slot: "intent-to-work", termId: "t-26W", updatedAt: "2026-01-01" }),
    ];
    expect(pickStaffingBinding(bindings)?.slot).toBe("intent-to-work");
  });
});

describe("setSlotBinding moving between cycles", () => {
  // A form drives one cycle's slot at a time (a fill is addressed by token and
  // carries no cycle), so binding it where another cycle holds it is a move.
  function heldByOtherCycle(overrides: Record<string, unknown> = {}) {
    return {
      id: "b-27w",
      columnMapping: { version: 1, entries: [] },
      gateAudience: "Members",
      gateAudienceGroupId: null,
      staffingCycle: { name: "27W Staffing" },
      ...overrides,
    };
  }

  function armTransaction() {
    mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
      (fn as (tx: unknown) => Promise<unknown>)(mockPrisma),
    );
  }

  it("refuses the move without an acknowledgement, naming the cycle", async () => {
    vi.resetAllMocks();
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    mockPrisma.staffingCycleFormBinding.findFirst.mockResolvedValue(
      heldByOtherCycle(),
    );

    const result = await setSlotBinding("cyc-27s", "intent-to-work", "form-1", "u-1");

    expect(result).toEqual({
      ok: false,
      error:
        "This form is already collecting for 27W Staffing. Confirm the move, or pick a different form.",
    });
    expect(mockPrisma.staffingCycleFormBinding.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.staffingCycleFormBinding.delete).not.toHaveBeenCalled();
  });

  it("moves the binding on acknowledgement, carrying mapping and app lock", async () => {
    vi.resetAllMocks();
    armTransaction();
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    mockPrisma.staffingCycleFormBinding.findFirst.mockResolvedValue(
      heldByOtherCycle(),
    );
    mockPrisma.staffingCycleFormBinding.delete.mockResolvedValue({});
    mockPrisma.staffingCycleFormBinding.upsert.mockResolvedValue({});

    const result = await setSlotBinding(
      "cyc-27s",
      "intent-to-work",
      "form-1",
      "u-1",
      { allowMove: true },
    );

    expect(result).toEqual({ ok: true, movedFrom: "27W Staffing" });
    expect(mockPrisma.staffingCycleFormBinding.delete).toHaveBeenCalledWith({
      where: { id: "b-27w" },
    });
    expect(mockPrisma.staffingCycleFormBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          staffingCycleId: "cyc-27s",
          formId: "form-1",
          columnMapping: { version: 1, entries: [] },
          gateAudience: "Members",
        }),
      }),
    );
  });

  it("needs no acknowledgement when no other cycle holds the form", async () => {
    vi.resetAllMocks();
    armTransaction();
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    mockPrisma.staffingCycleFormBinding.findFirst.mockResolvedValue(null);
    mockPrisma.staffingCycleFormBinding.upsert.mockResolvedValue({});

    expect(
      await setSlotBinding("cyc-27s", "intent-to-work", "form-1", "u-1"),
    ).toEqual({ ok: true });
    expect(mockPrisma.staffingCycleFormBinding.delete).not.toHaveBeenCalled();
  });
});

describe("listSelectableForms", () => {
  it("flags the forms another cycle holds for the slot", async () => {
    vi.resetAllMocks();
    mockPrisma.form.findMany.mockResolvedValue([
      { id: "form-1", name: "Intent to Work", published: true },
      { id: "form-2", name: "Level Up", published: true },
    ]);
    mockPrisma.staffingCycleFormBinding.findMany.mockResolvedValue([
      { formId: "form-1", staffingCycle: { name: "27W Staffing" } },
    ]);

    const forms = await listSelectableForms({
      slot: "intent-to-work",
      exceptCycleId: "cyc-27s",
    });

    expect(forms).toEqual([
      {
        id: "form-1",
        name: "Intent to Work",
        published: true,
        boundToCycleName: "27W Staffing",
      },
      { id: "form-2", name: "Level Up", published: true },
    ]);
  });

  it("skips the binding query when no slot is given", async () => {
    vi.resetAllMocks();
    mockPrisma.form.findMany.mockResolvedValue([]);
    expect(await listSelectableForms()).toEqual([]);
    expect(
      mockPrisma.staffingCycleFormBinding.findMany,
    ).not.toHaveBeenCalled();
  });
});

describe("boundSlotCycleIds", () => {
  it("returns every cycle the form is bound to for that slot", async () => {
    vi.resetAllMocks();
    mockPrisma.staffingCycleFormBinding.findMany.mockResolvedValue([
      { staffingCycleId: "cyc-26F" },
      { staffingCycleId: "cyc-27W" },
    ]);
    const ids = await boundSlotCycleIds("form-1", "intent-to-work");
    expect(ids).toEqual(["cyc-26F", "cyc-27W"]);
    expect(mockPrisma.staffingCycleFormBinding.findMany).toHaveBeenCalledWith({
      where: { formId: "form-1", slot: "intent-to-work" },
      select: { staffingCycleId: true },
    });
  });

  it("is empty when the form is bound to nothing", async () => {
    vi.resetAllMocks();
    mockPrisma.staffingCycleFormBinding.findMany.mockResolvedValue([]);
    expect(await boundSlotCycleIds("form-1", "project-bids")).toEqual([]);
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

describe("setSlotBinding", () => {
  it("unbinds the slot when the form id is empty", async () => {
    vi.resetAllMocks();
    mockPrisma.staffingCycleFormBinding.deleteMany.mockResolvedValue({ count: 1 });
    const result = await setSlotBinding("cyc-1", "intent-to-work", "", "u-1");
    expect(result.ok).toBe(true);
    expect(mockPrisma.staffingCycleFormBinding.deleteMany).toHaveBeenCalledWith({
      where: { staffingCycleId: "cyc-1", slot: "intent-to-work" },
    });
    // No form lookup, and nothing written back to the slot.
    expect(mockPrisma.form.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.staffingCycleFormBinding.upsert).not.toHaveBeenCalled();
  });

  it("still rejects a form id that doesn't resolve", async () => {
    vi.resetAllMocks();
    mockPrisma.form.findUnique.mockResolvedValue(null);
    const result = await setSlotBinding("cyc-1", "intent-to-work", "form-gone", "u-1");
    expect(result.ok).toBe(false);
    expect(mockPrisma.staffingCycleFormBinding.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.staffingCycleFormBinding.upsert).not.toHaveBeenCalled();
  });

  it("binds the slot to a real form", async () => {
    vi.resetAllMocks();
    // The bind runs in a transaction (it may also release another cycle).
    mockPrisma.$transaction.mockImplementation(async (fn: unknown) =>
      (fn as (tx: unknown) => Promise<unknown>)(mockPrisma),
    );
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
    mockPrisma.staffingCycleFormBinding.findFirst.mockResolvedValue(null);
    mockPrisma.staffingCycleFormBinding.upsert.mockResolvedValue({});
    const result = await setSlotBinding("cyc-1", "project-bids", "form-1", "u-1");
    expect(result.ok).toBe(true);
    expect(mockPrisma.staffingCycleFormBinding.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.staffingCycleFormBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ formId: "form-1", slot: "project-bids" }),
        update: expect.objectContaining({ formId: "form-1" }),
      }),
    );
  });
});
