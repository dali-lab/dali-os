import { describe, it, expect, vi } from "vitest";
// form-slots.ts imports the real ~/lib/db at module load (for other helpers);
// stub it so importing this pure function doesn't pull in the generated Prisma
// client, which isn't built during the unit-test CI job. pickStaffingBinding
// never touches prisma, so the mock is inert.
vi.mock("~/lib/db");
import { pickStaffingBinding } from "~/projects/lib/form-slots";

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
