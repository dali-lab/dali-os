import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    adminMembership: { findFirst: vi.fn() },
    expenseCard: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    expenseCategory: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    expense: { count: vi.fn() },
  },
}));
vi.mock("~/lib/db.server", () => ({ prisma: m.prisma }));

import type { ExpenseViewer } from "../access";
import {
  archiveCard,
  archiveCategory,
  createCard,
  createCategory,
  listCards,
  updateCard,
  updateCategory,
} from "../cards.server";
import { ExpenseError } from "../errors";

const viewer = (over: Partial<ExpenseViewer> = {}): ExpenseViewer => ({ userId: "u", isCore: false, isStaff: false, ownedCardIds: [], ...over });
const core = viewer({ isCore: true });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ExpenseError ? e.code : `other:${(e as Error).message}`;
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.adminMembership.findFirst.mockResolvedValue({ id: "a" });
  m.prisma.expenseCategory.findUnique.mockResolvedValue({ id: "cat" });
});

describe("card and category management is Core only", () => {
  it.each([
    ["createCard", (a: ExpenseViewer) => createCard(a, { nickname: "X", last4: "1234", ownerId: "o" })],
    ["updateCard", (a: ExpenseViewer) => updateCard(a, "c1", { nickname: "Y" })],
    ["archiveCard", (a: ExpenseViewer) => archiveCard(a, "c1")],
    ["createCategory", (a: ExpenseViewer) => createCategory(a, { label: "X" })],
    ["updateCategory", (a: ExpenseViewer) => updateCategory(a, "k", { label: "Y" })],
    ["archiveCategory", (a: ExpenseViewer) => archiveCategory(a, "k")],
  ])("%s rejects staff and card owners", async (_n, run) => {
    expect(await code(run(viewer({ isStaff: true, ownedCardIds: ["c1"] })))).toBe("forbidden");
    expect(await code(run(viewer()))).toBe("forbidden");
  });
});

describe("createCard", () => {
  it("stores only nickname and last four, deduping holders", async () => {
    m.prisma.expenseCard.create.mockResolvedValue({ id: "c1" });
    await createCard(core, { nickname: " Programs Visa ", last4: "4821", ownerId: "o", holderIds: ["a", "a", "b"] });
    expect(m.prisma.expenseCard.create.mock.calls[0][0].data).toEqual({
      nickname: "Programs Visa",
      last4: "4821",
      ownerId: "o",
      holderIds: ["a", "b"],
      defaultCategoryId: null,
    });
  });
  it.each(["482", "48211", "abcd", "4821 "])("rejects last four %j", async (last4) => {
    expect(await code(createCard(core, { nickname: "X", last4, ownerId: "o" }))).toBe("invalid");
  });
  it("rejects a blank nickname and a non-staff owner", async () => {
    expect(await code(createCard(core, { nickname: " ", last4: "1234", ownerId: "o" }))).toBe("invalid");
    m.prisma.adminMembership.findFirst.mockResolvedValue(null);
    expect(await code(createCard(core, { nickname: "X", last4: "1234", ownerId: "o" }))).toBe("invalid");
  });
  it("rejects an unknown default category", async () => {
    m.prisma.expenseCategory.findUnique.mockResolvedValue(null);
    expect(await code(createCard(core, { nickname: "X", last4: "1234", ownerId: "o", defaultCategoryId: "nope" }))).toBe("invalid");
  });
});

describe("updateCard", () => {
  it("changes the owner only to staff", async () => {
    m.prisma.adminMembership.findFirst.mockResolvedValue(null);
    expect(await code(updateCard(core, "c1", { ownerId: "x" }))).toBe("invalid");
  });
  it("reports a missing card", async () => {
    m.prisma.expenseCard.update.mockRejectedValue(Object.assign(new Error("x"), { code: "P2025" }));
    expect(await code(updateCard(core, "c1", { nickname: "Y" }))).toBe("not_found");
  });
});

describe("archiveCard", () => {
  it("asks to confirm while expenses are submitted", async () => {
    m.prisma.expense.count.mockResolvedValue(2);
    expect(await archiveCard(core, "c1")).toEqual({ archived: false, needsConfirm: true, submittedCount: 2 });
    expect(m.prisma.expenseCard.updateMany).not.toHaveBeenCalled();
  });
  it("archives after confirmation or when nothing is pending", async () => {
    m.prisma.expense.count.mockResolvedValue(2);
    m.prisma.expenseCard.updateMany.mockResolvedValue({ count: 1 });
    expect(await archiveCard(core, "c1", { confirm: true })).toEqual({ archived: true });
    m.prisma.expense.count.mockResolvedValue(0);
    expect(await archiveCard(core, "c1")).toEqual({ archived: true });
  });
  it("reports a missing card", async () => {
    m.prisma.expense.count.mockResolvedValue(0);
    m.prisma.expenseCard.updateMany.mockResolvedValue({ count: 0 });
    m.prisma.expenseCard.findUnique.mockResolvedValue(null);
    expect(await code(archiveCard(core, "c1"))).toBe("not_found");
  });
});

describe("categories", () => {
  it("validates and normalizes the chart string and hints", async () => {
    m.prisma.expenseCategory.findFirst.mockResolvedValue({ sortOrder: 6 });
    m.prisma.expenseCategory.create.mockResolvedValue({ id: "k" });
    await createCategory(core, { label: " Hackathon ", chartString: "20.330.161028.128512.3200", hints: [" Hack ", "hack", ""] });
    expect(m.prisma.expenseCategory.create.mock.calls[0][0].data).toEqual({
      label: "Hackathon",
      chartString: "20.330.161028.128512.3200",
      hints: ["hack"],
      sortOrder: 7,
    });
  });
  it("rejects a bad chart string and a blank label", async () => {
    expect(await code(createCategory(core, { label: "X", chartString: "nope" }))).toBe("invalid");
    expect(await code(createCategory(core, { label: " " }))).toBe("invalid");
    expect(await code(updateCategory(core, "k", { chartString: "nope" }))).toBe("invalid");
  });
  it("allows a category with no chart string", async () => {
    m.prisma.expenseCategory.findFirst.mockResolvedValue(null);
    m.prisma.expenseCategory.create.mockResolvedValue({ id: "k" });
    await createCategory(core, { label: "Misc", chartString: "" });
    expect(m.prisma.expenseCategory.create.mock.calls[0][0].data).toMatchObject({ chartString: null, sortOrder: 0 });
  });
  it("archives by stamping archivedAt", async () => {
    m.prisma.expenseCategory.updateMany.mockResolvedValue({ count: 1 });
    expect(await archiveCategory(core, "k")).toEqual({ archived: true });
  });
});

describe("listCards", () => {
  const rows = [
    { id: "c1", ownerId: "o", holderIds: ["h"], archivedAt: null },
    { id: "c2", ownerId: "p", holderIds: [], archivedAt: null },
  ];
  it("shows Core every card", async () => {
    m.prisma.expenseCard.findMany.mockResolvedValue(rows);
    expect(await listCards(core)).toHaveLength(2);
  });
  it("shows a member only cards they own or may file on", async () => {
    m.prisma.expenseCard.findMany.mockResolvedValue(rows);
    expect((await listCards(viewer({ userId: "h" }))).map((c) => c.id)).toEqual(["c1"]);
    expect((await listCards(viewer({ userId: "p", ownedCardIds: ["c2"] }))).map((c) => c.id)).toEqual(["c2"]);
    expect(await listCards(viewer({ userId: "zz" }))).toEqual([]);
  });
});
