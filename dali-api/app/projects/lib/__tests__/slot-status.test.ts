import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { deriveSlotStatus } from "~/projects/lib/slot-status.server";

const mockPrisma = prisma as unknown as {
  staffingCycleFormBinding: { findUnique: ReturnType<typeof vi.fn> };
  notification: { findMany: ReturnType<typeof vi.fn> };
};

// getSlotBinding reads StaffingCycleFormBinding.findUnique and returns a
// parsed binding; deriveSlotStatus then counts distinct Notification
// recipients keyed on the bound form id.
function bindingRow(opts: {
  formId: string;
  published?: boolean;
  publicToken?: string | null;
  columnMapping?: object | null;
}) {
  return {
    updatedAt: new Date("2026-01-01"),
    columnMapping: opts.columnMapping ?? null,
    form: {
      id: opts.formId,
      name: "A Form",
      published: opts.published ?? true,
      publicToken: opts.publicToken ?? "tok",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).staffingCycleFormBinding = { findUnique: vi.fn() };
  (mockPrisma as any).notification = { findMany: vi.fn() };
});

describe("deriveSlotStatus", () => {
  it("bound + mapped + sent → bound/mappingComplete true, count N", async () => {
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue(
      bindingRow({
        formId: "f1",
        columnMapping: { version: 1, entries: [] },
      }),
    );
    mockPrisma.notification.findMany.mockResolvedValue([
      { recipientUserId: "u1" },
      { recipientUserId: "u2" },
      { recipientUserId: "u3" },
    ]);

    const out = await deriveSlotStatus("cycle-1");
    const itw = out.find((s) => s.slot === "intent-to-work")!;
    expect(itw.bound).toBe(true);
    expect(itw.mappingComplete).toBe(true);
    expect(itw.sentToCount).toBe(3);
    // All three slots are reported.
    expect(out.map((s) => s.slot).sort()).toEqual(
      ["intent-to-work", "level-up", "project-bids"].sort(),
    );
  });

  it("bound but no column mapping → mappingComplete false", async () => {
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue(
      bindingRow({ formId: "f1", columnMapping: null }),
    );
    mockPrisma.notification.findMany.mockResolvedValue([
      { recipientUserId: "u1" },
    ]);

    const out = await deriveSlotStatus("cycle-1");
    expect(out[0].mappingComplete).toBe(false);
    expect(out[0].bound).toBe(true);
  });

  it("bound but zero notifications → sentToCount 0 (the bound-but-unsent case)", async () => {
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue(
      bindingRow({ formId: "f1", columnMapping: { version: 1, entries: [] } }),
    );
    mockPrisma.notification.findMany.mockResolvedValue([]);

    const out = await deriveSlotStatus("cycle-1");
    expect(out[0].bound).toBe(true);
    expect(out[0].sentToCount).toBe(0);
  });

  it("no binding → all false / count 0 and no notification query", async () => {
    mockPrisma.staffingCycleFormBinding.findUnique.mockResolvedValue(null);

    const out = await deriveSlotStatus("cycle-1");
    expect(out.every((s) => !s.bound)).toBe(true);
    expect(out.every((s) => !s.mappingComplete)).toBe(true);
    expect(out.every((s) => s.sentToCount === 0)).toBe(true);
    expect(mockPrisma.notification.findMany).not.toHaveBeenCalled();
  });
});
