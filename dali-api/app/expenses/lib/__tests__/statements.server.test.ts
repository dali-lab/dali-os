import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    expenseCard: { findUnique: vi.fn() },
    cardStatementCharge: { findMany: vi.fn(), createManyAndReturn: vi.fn(), update: vi.fn() },
    expense: { findMany: vi.fn(), updateMany: vi.fn() },
  },
}));
const audit = vi.hoisted(() => vi.fn());
vi.mock("~/lib/audit", () => ({ logAuditEvent: audit }));
vi.mock("~/lib/db.server", () => ({ prisma: m.prisma }));

import type { ExpenseViewer } from "../access";
import { ExpenseError } from "../errors";
import { importStatement, listCharges } from "../statements.server";

const viewer = (over: Partial<ExpenseViewer> = {}): ExpenseViewer => ({ userId: "u", isCore: false, isStaff: false, ownedCardIds: [], ...over });
const owner = viewer({ ownedCardIds: ["c1"] });
const map = { date: "Date", merchant: "Description", amount: "Amount" };
const csv = (...lines: string[]) => ["Date,Description,Amount", ...lines].join("\n");
const dec = (s: string) => ({ toString: () => s });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ExpenseError ? e.code : `other:${(e as Error).message}`;
  }
};

const stored = (id: string, merchant: string, amount: string, day = "2026-11-18") => ({
  id,
  cardId: "c1",
  merchant,
  amount: dec(amount),
  postedAt: new Date(`${day}T00:00:00Z`),
});

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.expenseCard.findUnique.mockResolvedValue({ id: "c1" });
  m.prisma.cardStatementCharge.createManyAndReturn.mockImplementation(async ({ data }: { data: unknown[] }) =>
    data.map((_, i) => stored(`n${i}`, "X", "1.00")),
  );
  m.prisma.expense.findMany.mockResolvedValue([]);
  m.prisma.expense.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.cardStatementCharge.findMany.mockResolvedValue([]);
});

describe("importStatement", () => {
  it("is limited to the card owner and Core", async () => {
    expect(await code(importStatement(viewer(), "c1", csv("11/17/2026,A,1.00"), map))).toBe("forbidden");
    expect(await code(importStatement(viewer({ ownedCardIds: ["c2"] }), "c1", csv("11/17/2026,A,1.00"), map))).toBe("forbidden");
    expect(m.prisma.cardStatementCharge.createManyAndReturn).not.toHaveBeenCalled();
  });
  it("rejects a missing card and an unreadable file", async () => {
    m.prisma.expenseCard.findUnique.mockResolvedValue(null);
    expect(await code(importStatement(owner, "c1", csv("11/17/2026,A,1.00"), map))).toBe("not_found");
    m.prisma.expenseCard.findUnique.mockResolvedValue({ id: "c1" });
    expect(await code(importStatement(owner, "c1", csv("nope,A,1.00"), map))).toBe("invalid");
    expect(await code(importStatement(owner, "c1", "a,b\n1,2", map))).toBe("invalid");
  });
  it("stores new rows with fingerprints and skips known ones", async () => {
    const first = csv("11/17/2026,A,1.00", "11/18/2026,B,2.00");
    let fingerprints: string[] = [];
    m.prisma.cardStatementCharge.createManyAndReturn.mockImplementationOnce(async ({ data }: { data: { fingerprint: string }[] }) => {
      fingerprints = data.map((d) => d.fingerprint);
      return data.map((_, i) => stored(`n${i}`, "X", "1.00"));
    });
    const r1 = await importStatement(owner, "c1", first, map);
    expect(r1).toMatchObject({ imported: 2, skipped: 0 });
    expect(m.prisma.cardStatementCharge.createManyAndReturn.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });

    m.prisma.cardStatementCharge.findMany.mockResolvedValueOnce(fingerprints.map((fingerprint) => ({ fingerprint })));
    m.prisma.cardStatementCharge.createManyAndReturn.mockClear();
    const r2 = await importStatement(owner, "c1", first, map);
    expect(r2).toMatchObject({ imported: 0, skipped: 2 });
    expect(m.prisma.cardStatementCharge.createManyAndReturn.mock.calls[0][0].data).toEqual([]);
  });
  it("keeps identical rows in one file as separate charges", async () => {
    await importStatement(owner, "c1", csv("11/17/2026,A,1.00", "11/17/2026,A,1.00"), map);
    const data = m.prisma.cardStatementCharge.createManyAndReturn.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data[0].fingerprint).not.toBe(data[1].fingerprint);
  });
  it("converts amounts to exact decimal strings", async () => {
    await importStatement(owner, "c1", csv('11/17/2026,A,"$1,234.50"', "11/18/2026,B,(12.05)"), map);
    const data = m.prisma.cardStatementCharge.createManyAndReturn.mock.calls[0][0].data;
    expect(data.map((d: { amount: string }) => d.amount)).toEqual(["1234.50", "-12.05"]);
    expect(data[0]).toMatchObject({ cardId: "c1", importedById: "u" });
  });
  it("reports row errors alongside the import", async () => {
    const r = await importStatement(owner, "c1", csv("bad,A,1.00", "11/17/2026,B,1.00"), map);
    expect(r.imported).toBe(1);
    expect(r.errors).toHaveLength(1);
  });
  it("links a refund to the original charge", async () => {
    m.prisma.cardStatementCharge.createManyAndReturn.mockResolvedValue([stored("ref", "STAPLES", "-25.00", "2026-11-15")]);
    m.prisma.cardStatementCharge.findMany.mockImplementation(async (args: { where: { amount?: unknown } }) =>
      args.where.amount ? [stored("orig", "Staples #55", "25.00", "2026-11-10")] : [],
    );
    await importStatement(owner, "c1", csv("11/15/2026,STAPLES,-25.00"), map);
    expect(m.prisma.cardStatementCharge.update).toHaveBeenCalledWith({ where: { id: "ref" }, data: { refundOfChargeId: "orig" } });
  });
  it("auto-matches approved staff card expenses and reports the counts", async () => {
    m.prisma.cardStatementCharge.findMany.mockImplementation(async (args: { where: { expense?: unknown; fingerprint?: unknown } }) =>
      args.where.expense ? [stored("ch1", "GNOMON COPY HANOVER", "36.87"), stored("ch2", "UNKNOWN", "9.99", "2026-11-01")] : [],
    );
    m.prisma.expense.findMany.mockResolvedValue([
      {
        id: "e1",
        cardId: "c1",
        merchant: "Gnomon Copy",
        purchasedAt: new Date("2026-11-17T00:00:00Z"),
        total: dec("36.87"),
        extraction: null,
      },
      { id: "e2", cardId: "c1", merchant: "Lost Co", purchasedAt: new Date("2026-10-01T00:00:00Z"), total: dec("5.00"), extraction: null },
    ]);
    const r = await importStatement(owner, "c1", csv("11/18/2026,GNOMON COPY HANOVER,36.87"), map);
    expect(m.prisma.expense.updateMany).toHaveBeenCalledWith({
      where: { id: "e1", status: "APPROVED", statementChargeId: null },
      data: { statementChargeId: "ch1" },
    });
    expect(r).toMatchObject({ matched: 1, needsReceipt: 1, notOnStatement: 1, ambiguous: 0 });
  });
  it("counts ambiguity instead of matching", async () => {
    m.prisma.cardStatementCharge.findMany.mockImplementation(async (args: { where: { expense?: unknown } }) =>
      args.where.expense ? [stored("ch1", "GNOMON COPY", "36.87")] : [],
    );
    const e = (id: string) => ({ id, cardId: "c1", merchant: "Gnomon Copy", purchasedAt: new Date("2026-11-17T00:00:00Z"), total: dec("36.87"), extraction: null });
    m.prisma.expense.findMany.mockResolvedValue([e("e1"), e("e2")]);
    const r = await importStatement(owner, "c1", csv("11/18/2026,GNOMON COPY,36.87"), map);
    expect(m.prisma.expense.updateMany).not.toHaveBeenCalled();
    expect(r).toMatchObject({ matched: 0, ambiguous: 1, needsReceipt: 1, notOnStatement: 2 });
  });
  it("skips a match another import claimed first", async () => {
    m.prisma.cardStatementCharge.findMany.mockImplementation(async (args: { where: { expense?: unknown } }) =>
      args.where.expense ? [stored("ch1", "GNOMON COPY", "36.87")] : [],
    );
    m.prisma.expense.findMany.mockResolvedValue([
      { id: "e1", cardId: "c1", merchant: "Gnomon Copy", purchasedAt: new Date("2026-11-17T00:00:00Z"), total: dec("36.87"), extraction: null },
    ]);
    m.prisma.expense.updateMany.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    const r = await importStatement(owner, "c1", csv("11/18/2026,GNOMON COPY,36.87"), map);
    expect(r.matched).toBe(0);
  });
});

describe("listCharges", () => {
  it("is limited to the card owner and Core", async () => {
    expect(await code(listCharges(viewer(), "c1"))).toBe("forbidden");
  });
  it("derives match state and filters by it", async () => {
    m.prisma.cardStatementCharge.findMany.mockResolvedValue([
      { ...stored("a", "A", "5.00"), expense: { id: "e1" }, rawRow: {} },
      { ...stored("b", "B", "6.00"), expense: null, rawRow: {} },
      { ...stored("c", "C", "-7.00"), expense: null, rawRow: {} },
    ]);
    const all = await listCharges(owner, "c1");
    expect(all.map((c) => c.state)).toEqual(["matched", "needs_receipt", "refund"]);
    expect(all.every((c) => !("rawRow" in c))).toBe(true);
    expect((await listCharges(owner, "c1", { state: "needs_receipt" })).map((c) => c.id)).toEqual(["b"]);
  });
});

describe("importStatement audit", () => {
  it("records the import against the card", async () => {
    await importStatement(owner, "c1", csv("11/17/2026,A,1.00", "11/18/2026,B,2.00"), map);
    expect(audit).toHaveBeenCalledWith({ action: "expense.statement.import", userId: "u", targetId: "c1", metadata: { imported: 2, skipped: 0 } });
  });

  it("records nothing when the import is refused", async () => {
    await code(importStatement(viewer(), "c1", csv("11/17/2026,A,1.00"), map));
    expect(audit).not.toHaveBeenCalled();
  });
});
