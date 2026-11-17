import { describe, expect, it } from "vitest";
import { makeUser } from "../../../../integration/factories-misc";
import { prisma } from "../../../../integration/db";
import type { ExpenseViewer } from "../access";
import { importStatement } from "../statements.server";

async function setup() {
  const owner = await makeUser();
  const filer = await makeUser();
  const card = await prisma.expenseCard.create({ data: { nickname: "Programs Visa", last4: "4821", ownerId: owner.id } });
  const other = await prisma.expenseCard.create({ data: { nickname: "Projects Amex", last4: "1005", ownerId: owner.id } });
  const charge = (cardId: string, fingerprint: string) =>
    prisma.cardStatementCharge.create({
      data: { cardId, postedAt: new Date("2026-11-18T00:00:00Z"), merchant: "Gnomon Copy", amount: "36.87", fingerprint, rawRow: {}, importedById: owner.id },
    });
  const expense = (data: Record<string, unknown> = {}) =>
    prisma.expense.create({ data: { submitterId: filer.id, status: "APPROVED", paidWith: "STAFF_CARD", cardId: card.id, ...data } });
  const viewer: ExpenseViewer = { userId: owner.id, isCore: false, isStaff: true, ownedCardIds: [card.id] };
  return { owner, filer, card, other, charge, expense, viewer };
}

describe("card statement charges", () => {
  it("rejects the same fingerprint twice on one card", async () => {
    const { card, charge } = await setup();
    await charge(card.id, "fp1");
    await expect(charge(card.id, "fp1")).rejects.toMatchObject({ code: "P2002" });
  });
  it("allows the same fingerprint on a different card", async () => {
    const { card, other, charge } = await setup();
    await charge(card.id, "fp1");
    await expect(charge(other.id, "fp1")).resolves.toBeTruthy();
  });
});

describe("statementChargeId", () => {
  it("links one charge to at most one expense", async () => {
    const { card, charge, expense } = await setup();
    const c = await charge(card.id, "fp1");
    await expense({ statementChargeId: c.id });
    await expect(expense({ statementChargeId: c.id })).rejects.toMatchObject({ code: "P2002" });
  });
  it("lets many expenses stay unlinked", async () => {
    const { expense } = await setup();
    await expense();
    await expect(expense()).resolves.toBeTruthy();
  });
  it("unlinks the expense when the charge is deleted", async () => {
    const { card, charge, expense } = await setup();
    const c = await charge(card.id, "fp1");
    const e = await expense({ statementChargeId: c.id });
    await prisma.cardStatementCharge.delete({ where: { id: c.id } });
    expect((await prisma.expense.findUnique({ where: { id: e.id } }))?.statementChargeId).toBeNull();
  });
});

describe("importStatement against the database", () => {
  const map = { date: "Date", merchant: "Description", amount: "Amount" };
  const file = (...lines: string[]) => ["Date,Description,Amount", ...lines].join("\n");

  it("is idempotent when an overlapping file is uploaded again", async () => {
    const { card, viewer } = await setup();
    const first = file("11/17/2026,GNOMON COPY,36.87", "11/18/2026,CO-OP,12.50");
    expect(await importStatement(viewer, card.id, first, map)).toMatchObject({ imported: 2, skipped: 0 });
    const overlap = file("11/17/2026,GNOMON COPY,36.87", "11/18/2026,CO-OP,12.50", "11/19/2026,STAPLES,8.00");
    expect(await importStatement(viewer, card.id, overlap, map)).toMatchObject({ imported: 1, skipped: 2 });
    expect(await prisma.cardStatementCharge.count({ where: { cardId: card.id } })).toBe(3);
  });
  it("keeps two identical charges on the same day as two rows", async () => {
    const { card, viewer } = await setup();
    const twice = file("11/17/2026,VENDING,2.00", "11/17/2026,VENDING,2.00");
    expect(await importStatement(viewer, card.id, twice, map)).toMatchObject({ imported: 2 });
    expect(await importStatement(viewer, card.id, twice, map)).toMatchObject({ imported: 0, skipped: 2 });
  });
  it("matches an approved expense to its charge once, and reports what is left", async () => {
    const { card, viewer, expense } = await setup();
    const e = await expense({ merchant: "Gnomon Copy", purchasedAt: new Date("2026-11-17T00:00:00Z"), total: "36.87" });
    const r = await importStatement(viewer, card.id, file("11/18/2026,GNOMON COPY HANOVER,36.87", "11/18/2026,MYSTERY,9.99"), map);
    expect(r).toMatchObject({ matched: 1, needsReceipt: 1, notOnStatement: 0 });
    const linked = await prisma.expense.findUnique({ where: { id: e.id } });
    expect(linked?.statementChargeId).toBeTruthy();
    const again = await importStatement(viewer, card.id, file("11/18/2026,GNOMON COPY HANOVER,36.87"), map);
    expect(again).toMatchObject({ imported: 0, matched: 0 });
  });
  it("links a refund to its original charge", async () => {
    const { card, viewer } = await setup();
    await importStatement(viewer, card.id, file("11/10/2026,STAPLES #55,25.00", "11/15/2026,STAPLES,-25.00"), map);
    const refund = await prisma.cardStatementCharge.findFirst({ where: { cardId: card.id, amount: "-25.00" } });
    const original = await prisma.cardStatementCharge.findFirst({ where: { cardId: card.id, amount: "25.00" } });
    expect(refund?.refundOfChargeId).toBe(original?.id);
  });
});
