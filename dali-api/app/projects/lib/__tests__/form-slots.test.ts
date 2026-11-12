import { describe, it, expect, vi } from "vitest";
// form-slots.ts imports the real ~/lib/db.server at module load (for other helpers);
// stub it so importing this pure function doesn't pull in the generated Prisma
// client, which isn't built during the unit-test CI job. pickStaffingBinding
// never touches prisma, so the mock is inert.
vi.mock("~/lib/db.server");
import {
  pickStaffingBinding,
  boundSlotCycleIds,
  isGateAudience,
  listSelectableForms,
  setSlotBinding,
  setSlotGate,
  setSlotPublished,
  setSlotBuiltinColumn,
} from "~/projects/lib/form-slots";
import { prisma } from "~/lib/db.server";

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
  formVersionId?: string | null;
}) {
  return {
    id: opts.id ?? `${opts.slot}-${opts.termId}`,
    slot: opts.slot,
    termId: opts.termId,
    updatedAt: new Date(opts.updatedAt),
    formVersionId: opts.formVersionId ?? null,
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

  it("prefers the binding pinned to the version being served", () => {
    // 26F pinned v1, 27W pinned v2 (the latest). A fill of v2 belongs to 27W
    // even though 26F was bound more recently.
    const bindings = [
      binding({ slot: "intent-to-work", termId: "t-26F", updatedAt: "2026-10-01", formVersionId: "v-1" }),
      binding({ slot: "intent-to-work", termId: "t-27W", updatedAt: "2026-09-20", formVersionId: "v-2" }),
    ];
    expect(pickStaffingBinding(bindings, "v-2")?.termId).toBe("t-27W");
  });

  it("treats an unpinned binding as current", () => {
    const bindings = [
      binding({ slot: "level-up", termId: "t-26F", updatedAt: "2026-10-01", formVersionId: "v-1" }),
      binding({ slot: "level-up", termId: "t-27W", updatedAt: "2026-09-20", formVersionId: null }),
    ];
    expect(pickStaffingBinding(bindings, "v-2")?.termId).toBe("t-27W");
  });

  it("falls back to the most recent binding when none pins the served version", () => {
    // The author saved a new version but nobody re-bound it: fills still
    // record to the manager's last-bound cycle rather than nowhere.
    const bindings = [
      binding({ slot: "intent-to-work", termId: "t-26F", updatedAt: "2026-10-01", formVersionId: "v-1" }),
    ];
    expect(pickStaffingBinding(bindings, "v-2")?.termId).toBe("t-26F");
  });
});

describe("setSlotBinding moving between cycles", () => {
  // A form drives one cycle's slot at a time (a fill is addressed by token and
  // carries no cycle), so binding it where another cycle holds it is a move.
  function heldByOtherCycle(overrides: Record<string, unknown> = {}) {
    return {
      id: "b-27w",
      slot: "intent-to-work",
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
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", versions: [{ id: "v-2" }] });
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
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", versions: [{ id: "v-2" }] });
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

  it("treats a binding on a DIFFERENT slot as a move too", async () => {
    // pickStaffingBinding arbitrates across all of a form's slot bindings, so
    // one form on 26F Project Bids and 27W Intent to Work is the same
    // ambiguity as one form on two cycles of a single slot.
    vi.resetAllMocks();
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", versions: [{ id: "v-2" }] });
    mockPrisma.staffingCycleFormBinding.findFirst.mockResolvedValue(
      heldByOtherCycle({ slot: "project-bids", staffingCycle: { name: "26F Staffing" } }),
    );

    const result = await setSlotBinding("cyc-27w", "intent-to-work", "form-1", "u-1");

    expect(result).toEqual({
      ok: false,
      error:
        "This form is already collecting for 26F Staffing (Project Bids). Confirm the move, or pick a different form.",
    });
    // The query spans every staffing slot, excluding only this cycle+slot,
    // and only bindings holding the form's current version conflict.
    expect(mockPrisma.staffingCycleFormBinding.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          formId: "form-1",
          slot: { in: ["intent-to-work", "project-bids", "level-up"] },
          NOT: { staffingCycleId: "cyc-27w", slot: "intent-to-work" },
          OR: [{ formVersionId: null }, { formVersionId: "v-2" }],
        }),
      }),
    );
  });

  it("pins the bound version on create and update", async () => {
    vi.resetAllMocks();
    armTransaction();
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", versions: [{ id: "v-2" }] });
    mockPrisma.staffingCycleFormBinding.findFirst.mockResolvedValue(null);
    mockPrisma.staffingCycleFormBinding.upsert.mockResolvedValue({});

    await setSlotBinding("cyc-27s", "intent-to-work", "form-1", "u-1");

    expect(mockPrisma.staffingCycleFormBinding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ formVersionId: "v-2" }),
        update: expect.objectContaining({ formVersionId: "v-2" }),
      }),
    );
  });

  it("does not carry a slot-shaped mapping across slots", async () => {
    // A project-bids mapping names project/domain roles that intent-to-work
    // doesn't have, so it would fail validateMapping on arrival.
    vi.resetAllMocks();
    armTransaction();
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", versions: [{ id: "v-2" }] });
    mockPrisma.staffingCycleFormBinding.findFirst.mockResolvedValue(
      heldByOtherCycle({ slot: "project-bids" }),
    );
    mockPrisma.staffingCycleFormBinding.delete.mockResolvedValue({});
    mockPrisma.staffingCycleFormBinding.upsert.mockResolvedValue({});

    await setSlotBinding("cyc-27w", "intent-to-work", "form-1", "u-1", {
      allowMove: true,
    });

    const call = mockPrisma.staffingCycleFormBinding.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(call.create.columnMapping).toBeUndefined();
    expect(call.create.gateAudience).toBeUndefined();
  });

  it("needs no acknowledgement when no other cycle holds the form", async () => {
    vi.resetAllMocks();
    armTransaction();
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", versions: [{ id: "v-2" }] });
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
      { id: "form-1", name: "Intent to Work", published: true, versions: [{ id: "v-1" }] },
      { id: "form-2", name: "Level Up", published: true, versions: [{ id: "v-9" }] },
    ]);
    mockPrisma.staffingCycleFormBinding.findMany.mockResolvedValue([
      {
        formId: "form-1",
        formVersionId: "v-1",
        slot: "intent-to-work",
        staffingCycle: { name: "27W Staffing" },
      },
      {
        formId: "form-2",
        formVersionId: null,
        slot: "project-bids",
        staffingCycle: { name: "26F Staffing" },
      },
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
      {
        id: "form-2",
        name: "Level Up",
        published: true,
        // Held for a different slot, so the label says which.
        boundToCycleName: "26F Staffing (Project Bids)",
      },
    ]);
  });

  it("doesn't flag a form whose other binding pins an older version", async () => {
    // 26F holds v1 of the form, but the form's latest is v2 — binding it here
    // pins v2, which doesn't disturb 26F, so the picker shows it as free.
    vi.resetAllMocks();
    mockPrisma.form.findMany.mockResolvedValue([
      { id: "form-1", name: "Intent to Work", published: true, versions: [{ id: "v-2" }] },
    ]);
    mockPrisma.staffingCycleFormBinding.findMany.mockResolvedValue([
      {
        formId: "form-1",
        formVersionId: "v-1",
        slot: "intent-to-work",
        staffingCycle: { name: "26F Staffing" },
      },
    ]);

    expect(
      await listSelectableForms({ slot: "intent-to-work", exceptCycleId: "cyc-27s" }),
    ).toEqual([{ id: "form-1", name: "Intent to Work", published: true }]);
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
  it("returns every cycle bound for that slot on the current version", async () => {
    vi.resetAllMocks();
    mockPrisma.formVersion.findFirst.mockResolvedValue({ id: "v-2" });
    mockPrisma.staffingCycleFormBinding.findMany.mockResolvedValue([
      { staffingCycleId: "cyc-26F", formVersionId: null },
      { staffingCycleId: "cyc-27W", formVersionId: "v-2" },
    ]);
    const ids = await boundSlotCycleIds("form-1", "intent-to-work");
    expect(ids).toEqual(["cyc-26F", "cyc-27W"]);
    expect(mockPrisma.staffingCycleFormBinding.findMany).toHaveBeenCalledWith({
      where: { formId: "form-1", slot: "intent-to-work" },
      select: { staffingCycleId: true, formVersionId: true },
    });
  });

  it("drops cycles whose binding pins an older version", async () => {
    // A member who filled the 26F round (v1) still owes the 27W round (v2),
    // so the one-and-done gate must not count the 26F cycle.
    vi.resetAllMocks();
    mockPrisma.formVersion.findFirst.mockResolvedValue({ id: "v-2" });
    mockPrisma.staffingCycleFormBinding.findMany.mockResolvedValue([
      { staffingCycleId: "cyc-26F", formVersionId: "v-1" },
      { staffingCycleId: "cyc-27W", formVersionId: "v-2" },
    ]);
    expect(await boundSlotCycleIds("form-1", "intent-to-work")).toEqual([
      "cyc-27W",
    ]);
  });

  it("is empty when the form is bound to nothing", async () => {
    vi.resetAllMocks();
    mockPrisma.formVersion.findFirst.mockResolvedValue(null);
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
  it("unbinds the slot when the form id is empty, via clearSlotBinding", async () => {
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
    mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1", versions: [{ id: "v-2" }] });
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

describe("setSlotPublished", () => {
  it("refuses when no form is connected to the slot", async () => {
    vi.resetAllMocks();
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue(null);

    const result = await setSlotPublished("cyc-1", "intent-to-work", true);

    expect(result.ok).toBe(false);
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });

  it("opens the bound form and clears its hidden schedule", async () => {
    vi.resetAllMocks();
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue({ formId: "form-1" });
    mockPrisma.form.findUnique.mockResolvedValue({
      publicToken: "tok",
      _count: { versions: 2 },
    });

    const result = await setSlotPublished("cyc-1", "intent-to-work", true);

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.staffingCycleFormBinding.findUnique).toHaveBeenCalledWith({
      where: { staffingCycleId_slot: { staffingCycleId: "cyc-1", slot: "intent-to-work" } },
      select: { formId: true },
    });
    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: { published: true, publicToken: "tok", opensAt: null, closesAt: null },
    });
  });

  it("closes the bound form", async () => {
    vi.resetAllMocks();
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue({ formId: "form-1" });
    mockPrisma.form.findUnique.mockResolvedValue({
      publicToken: "tok",
      _count: { versions: 2 },
    });

    await setSlotPublished("cyc-1", "level-up", false);

    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: { published: false, opensAt: null, closesAt: null },
    });
  });

  it("passes the publish error through", async () => {
    vi.resetAllMocks();
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue({ formId: "form-1" });
    mockPrisma.form.findUnique.mockResolvedValue({
      publicToken: null,
      _count: { versions: 0 },
    });

    const result = await setSlotPublished("cyc-1", "project-bids", true);

    expect(result).toEqual({
      ok: false,
      error: "Add at least one question version before publishing.",
    });
  });
});

describe("setSlotBuiltinColumn", () => {
  it("refuses a board with no form connected", async () => {
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue(null);
    expect(await setSlotBuiltinColumn("c1", "project-bids", "termsInLab", true, "u1")).toEqual({
      ok: false,
      error: "Connect a form before adding columns.",
    });
    expect(mockPrisma.staffingCycleFormBinding.update).not.toHaveBeenCalled();
  });

  it("saves the mapping with the column shown or hidden", async () => {
    mockPrisma.staffingCycleFormBinding.update.mockClear();
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue({ id: "b1", columnMapping: null });
    expect(await setSlotBuiltinColumn("c1", "intent-to-work", "termsInLab", true, "u1")).toEqual({ ok: true });
    expect(mockPrisma.staffingCycleFormBinding.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: {
        columnMapping: {
          version: 1,
          entries: [{ role: "termsInLab", label: "Terms in lab", source: "builtin", builtin: "termsInLab", order: 0 }],
        },
        updatedById: "u1",
      },
    });

    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue({
      id: "b1",
      columnMapping: mockPrisma.staffingCycleFormBinding.update.mock.calls[0][0].data.columnMapping,
    });
    await setSlotBuiltinColumn("c1", "intent-to-work", "termsInLab", false, "u1");
    expect(
      mockPrisma.staffingCycleFormBinding.update.mock.calls[1][0].data.columnMapping.entries[0].hidden,
    ).toBe(true);
  });
});
