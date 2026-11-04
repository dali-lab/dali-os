import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    mailCategory: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    mailCategoryAccount: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    mailAccount: { upsert: vi.fn(), findUniqueOrThrow: vi.fn() },
    mailAccountConnection: { deleteMany: vi.fn() },
    user: { findMany: vi.fn() },
    groupDefinition: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/prisma-shapes", () => ({ MEMBER_LIST_ORDER_BY: [{ lastName: "asc" }] }));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { MAX_CATEGORY_DESCRIPTION, MAX_CATEGORY_NAME } from "~/email/lib/categories";
import { handleInboxCategoryAction, loadInboxCategories } from "~/email/lib/categories.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const request = new Request("http://localhost/admin/email");

function form(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const run = async (fields: Record<string, string | string[]>) => {
  const res = await handleInboxCategoryAction(request, form(fields), "admin1");
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string } };
};

beforeEach(() => {
  vi.resetAllMocks();
  db.user.findMany.mockResolvedValue([]);
  db.groupDefinition.findMany.mockResolvedValue([]);
  db.mailAccount.upsert.mockImplementation(async ({ where }: { where: { scopeKey_address: { address: string } } }) => ({
    id: `acct-${where.scopeKey_address.address}`,
  }));
  db.mailCategory.create.mockResolvedValue({ id: "newcat" });
  db.mailCategoryAccount.findMany.mockResolvedValue([]);
  db.$transaction.mockResolvedValue([]);
});

describe("loadInboxCategories", () => {
  it("shapes categories with sorted inboxes and sign-in counts, and members with full names", async () => {
    db.mailCategory.findMany.mockResolvedValue([
      {
        id: "c1",
        name: "Admissions",
        description: "d",
        audienceUserIds: ["u1"],
        audienceGroupIds: ["g1"],
        _count: { subscriptions: 4 },
        accounts: [
          { account: { id: "a2", address: "z@example.edu", _count: { connections: 1 } } },
          { account: { id: "a1", address: "b@example.edu", _count: { connections: 3 } } },
        ],
      },
    ]);
    db.user.findMany.mockResolvedValue([{ id: "u1", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" }]);
    db.groupDefinition.findMany.mockResolvedValue([{ id: "g1", name: "Staff" }]);
    const data = await loadInboxCategories();
    expect(data.members).toEqual([{ id: "u1", name: "Ada Lovelace", email: "ada@example.edu" }]);
    expect(data.groups).toEqual([{ id: "g1", name: "Staff" }]);
    expect(data.categories[0]).toMatchObject({
      subscribers: 4,
      audienceUserIds: ["u1"],
      inboxes: [
        { id: "a1", address: "b@example.edu", signedIn: 3 },
        { id: "a2", address: "z@example.edu", signedIn: 1 },
      ],
    });
    expect(db.groupDefinition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { archivedAt: null } }));
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { daliMember: { isNot: null }, membershipStatus: "Active" } }),
    );
  });
});

describe("save-category validation", () => {
  it.each([
    ["a missing name", { name: "  " }, "Give the category a name."],
    ["a long name", { name: "x".repeat(MAX_CATEGORY_NAME + 1) }, `Keep the name under ${MAX_CATEGORY_NAME} characters.`],
    [
      "a long description",
      { name: "ok", description: "x".repeat(MAX_CATEGORY_DESCRIPTION + 1) },
      `Keep the description under ${MAX_CATEGORY_DESCRIPTION} characters.`,
    ],
    ["a malformed address", { name: "ok", inbox: ["good@example.edu", "nope"] }, "nope isn't a valid email address."],
  ])("rejects %s with 400 and writes nothing", async (_n, fields, error) => {
    const res = await run({ intent: "save-category", ...fields });
    expect(res).toEqual({ status: 400, body: { error } });
    expect(db.mailAccount.upsert).not.toHaveBeenCalled();
    expect(db.mailCategory.create).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("accepts a name and description at exactly the limit", async () => {
    const res = await run({
      intent: "save-category",
      name: "x".repeat(MAX_CATEGORY_NAME),
      description: "y".repeat(MAX_CATEGORY_DESCRIPTION),
    });
    expect(res.status).toBe(200);
  });
});

describe("save-category create", () => {
  it("lowercases addresses into shared inboxes, keeps only real audience members, and audits", async () => {
    db.user.findMany.mockResolvedValue([{ id: "u1" }]);
    db.groupDefinition.findMany.mockResolvedValue([{ id: "g1" }]);
    const res = await run({
      intent: "save-category",
      name: " Admissions ",
      description: " Apps ",
      inbox: ["Apply@Example.edu", ""],
      userId: ["u1", "ghost"],
      groupId: ["g1", "ghost"],
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ["u1", "ghost"] } }, select: { id: true } });
    expect(db.mailAccount.upsert).toHaveBeenCalledTimes(1);
    expect(db.mailAccount.upsert).toHaveBeenCalledWith({
      where: { scopeKey_address: { scopeKey: "shared", address: "apply@example.edu" } },
      create: { kind: "Shared", scopeKey: "shared", address: "apply@example.edu" },
      update: {},
      select: { id: true },
    });
    expect(db.mailCategory.create).toHaveBeenCalledWith({
      data: {
        name: "Admissions",
        description: "Apps",
        audienceUserIds: ["u1"],
        audienceGroupIds: ["g1"],
        accounts: { create: [{ accountId: "acct-apply@example.edu" }] },
      },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mail-category.create",
        userId: "admin1",
        targetId: "newcat",
        metadata: { name: "Admissions", inboxes: ["apply@example.edu"], users: 1, groups: 1 },
      }),
    );
  });

  it("reuses the inbox another save created at the same moment", async () => {
    db.mailAccount.upsert.mockRejectedValueOnce(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    db.mailAccount.findUniqueOrThrow.mockResolvedValue({ id: "acct-race" });
    const res = await run({ intent: "save-category", name: "Admissions", inbox: ["race@example.edu"] });
    expect(res.status).toBe(200);
    expect(db.mailAccount.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { scopeKey_address: { scopeKey: "shared", address: "race@example.edu" } },
      select: { id: true },
    });
    expect(db.mailCategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ accounts: { create: [{ accountId: "acct-race" }] } }),
    });
  });

  it("still fails on other database errors", async () => {
    db.mailAccount.upsert.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "P1001" }));
    await expect(run({ intent: "save-category", name: "Admissions", inbox: ["x@example.edu"] })).rejects.toThrow("boom");
  });

  it("treats addresses that differ only by case or spacing as one inbox", async () => {
    const res = await run({
      intent: "save-category",
      name: "Admissions",
      inbox: ["Apply@Example.edu", "apply@example.edu", " APPLY@example.edu "],
    });
    expect(res.status).toBe(200);
    expect(db.mailAccount.upsert).toHaveBeenCalledTimes(1);
    expect(db.mailCategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ accounts: { create: [{ accountId: "acct-apply@example.edu" }] } }),
    });
  });
});

describe("save-category update", () => {
  it("404s a category that no longer exists", async () => {
    db.mailCategory.findUnique.mockResolvedValue(null);
    const res = await run({ intent: "save-category", id: "c1", name: "ok" });
    expect(res.status).toBe(404);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("syncs the inbox list, then forgets sign-ins only for inboxes no category still lists", async () => {
    db.mailCategory.findUnique.mockResolvedValue({
      accounts: [{ accountId: "acct-keep@example.edu" }, { accountId: "gone1" }, { accountId: "gone2" }],
    });
    db.mailCategoryAccount.findMany.mockResolvedValue([{ accountId: "gone2" }]);
    const res = await run({ intent: "save-category", id: "c1", name: "ok", inbox: ["keep@example.edu"] });
    expect(res.status).toBe(200);
    expect(db.mailCategory.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({ name: "ok" }),
    });
    expect(db.mailCategoryAccount.deleteMany).toHaveBeenCalledWith({
      where: { categoryId: "c1", accountId: { notIn: ["acct-keep@example.edu"] } },
    });
    expect(db.mailCategoryAccount.createMany).toHaveBeenCalledWith({
      data: [{ categoryId: "c1", accountId: "acct-keep@example.edu" }],
      skipDuplicates: true,
    });
    expect(db.mailCategoryAccount.findMany).toHaveBeenCalledWith({
      where: { accountId: { in: ["gone1", "gone2"] } },
      select: { accountId: true },
    });
    expect(db.mailAccountConnection.deleteMany).toHaveBeenCalledWith({ where: { accountId: { in: ["gone1"] } } });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "mail-category.update", targetId: "c1" }));
  });

  it("does not touch sign-ins when no inbox was removed", async () => {
    db.mailCategory.findUnique.mockResolvedValue({ accounts: [{ accountId: "acct-a@example.edu" }] });
    await run({ intent: "save-category", id: "c1", name: "ok", inbox: ["a@example.edu"] });
    expect(db.mailAccountConnection.deleteMany).not.toHaveBeenCalled();
    expect(db.mailCategoryAccount.findMany).not.toHaveBeenCalled();
  });

  it("keeps sign-ins when every removed inbox is still in another category", async () => {
    db.mailCategory.findUnique.mockResolvedValue({ accounts: [{ accountId: "gone1" }] });
    db.mailCategoryAccount.findMany.mockResolvedValue([{ accountId: "gone1" }]);
    await run({ intent: "save-category", id: "c1", name: "ok" });
    expect(db.mailAccountConnection.deleteMany).not.toHaveBeenCalled();
  });
});

describe("delete-category", () => {
  it("404s an unknown category", async () => {
    db.mailCategory.findUnique.mockResolvedValue(null);
    expect((await run({ intent: "delete-category", id: "c1" })).status).toBe(404);
    expect(db.mailCategory.delete).not.toHaveBeenCalled();
  });

  it("deletes it, forgets sign-ins to inboxes left in no category, and audits", async () => {
    db.mailCategory.findUnique.mockResolvedValue({ name: "Admissions", accounts: [{ accountId: "a1" }, { accountId: "a2" }] });
    db.mailCategoryAccount.findMany.mockResolvedValue([{ accountId: "a2" }]);
    expect(await run({ intent: "delete-category", id: "c1" })).toEqual({ status: 200, body: { ok: true } });
    expect(db.mailCategory.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(db.mailAccountConnection.deleteMany).toHaveBeenCalledWith({ where: { accountId: { in: ["a1"] } } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mail-category.delete", targetId: "c1", metadata: { name: "Admissions" } }),
    );
  });
});

it("rejects unknown intents", async () => {
  expect(await run({ intent: "nope" })).toEqual({ status: 400, body: { error: "Unknown action." } });
});
