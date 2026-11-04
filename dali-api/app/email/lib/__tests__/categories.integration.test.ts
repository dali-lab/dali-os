import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { handleInboxCategoryAction } from "~/email/lib/categories.server";

const request = new Request("http://localhost/admin/email");

function form(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const run = async (fields: Record<string, string | string[]>, userId = "admin") => {
  const res = await handleInboxCategoryAction(request, form(fields), userId);
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string } };
};

async function connect(address: string, categoryIds: string[] = []) {
  const account = await prisma.mailAccount.findUniqueOrThrow({
    where: { scopeKey_address: { scopeKey: "shared", address } },
  });
  const user = await prisma.user.create({ data: { firstName: "Ada", lastName: `L${Math.random()}` } });
  await prisma.mailAccountConnection.create({ data: { accountId: account.id, userId: user.id, oauthTokens: "enc" } });
  return { account, categoryIds };
}

describe("save-category (real database)", () => {
  it("collapses case and spacing duplicate addresses into one account and one link", async () => {
    const res = await run({ intent: "save-category", name: "Admissions", inbox: ["Apply@Example.edu", " apply@example.edu "] });

    expect(res).toEqual({ status: 200, body: { ok: true } });
    const accounts = await prisma.mailAccount.findMany();
    expect(accounts.map((a) => [a.address, a.kind, a.scopeKey])).toEqual([["apply@example.edu", "Shared", "shared"]]);
    expect(await prisma.mailCategoryAccount.count()).toBe(1);
    expect(await prisma.mailCategory.count()).toBe(1);
  });

  it("reuses one shared account across categories", async () => {
    await run({ intent: "save-category", name: "A", inbox: "help@example.edu" });
    await run({ intent: "save-category", name: "B", inbox: "Help@example.edu" });

    expect(await prisma.mailAccount.count()).toBe(1);
    expect(await prisma.mailCategory.count()).toBe(2);
    expect(await prisma.mailCategoryAccount.count()).toBe(2);
  });

  it("keeps only real users and groups in the audience", async () => {
    const ada = await prisma.user.create({ data: { firstName: "Ada", lastName: "Lovelace" } });

    await run({ intent: "save-category", name: "Team", userId: [ada.id, "ghost"], groupId: "nope" });

    const cat = await prisma.mailCategory.findFirstOrThrow();
    expect(cat.audienceUserIds).toEqual([ada.id]);
    expect(cat.audienceGroupIds).toEqual([]);
  });

  it("update removes dropped links, keeps the rest, and forgets sign-ins only for orphaned inboxes", async () => {
    await run({ intent: "save-category", name: "Main", inbox: ["keep@example.edu", "drop@example.edu", "shared@example.edu"] });
    const main = await prisma.mailCategory.findFirstOrThrow();
    await run({ intent: "save-category", name: "Other", inbox: "shared@example.edu" });
    await connect("keep@example.edu");
    await connect("drop@example.edu");
    await connect("shared@example.edu");

    const res = await run({ intent: "save-category", id: main.id, name: "Main renamed", inbox: ["keep@example.edu", "new@example.edu"] });

    expect(res.status).toBe(200);
    const links = await prisma.mailCategoryAccount.findMany({
      where: { categoryId: main.id },
      include: { account: true },
    });
    expect(links.map((l) => l.account.address).sort()).toEqual(["keep@example.edu", "new@example.edu"]);
    expect((await prisma.mailCategory.findUniqueOrThrow({ where: { id: main.id } })).name).toBe("Main renamed");
    const connected = await prisma.mailAccountConnection.findMany({ include: { account: true } });
    // drop@ is in no category now, so its sign-in is gone; shared@ is still listed by "Other".
    expect(connected.map((c) => c.account.address).sort()).toEqual(["keep@example.edu", "shared@example.edu"]);
  });

  it("update of a missing category is a 404 and writes no category", async () => {
    const res = await run({ intent: "save-category", id: "missing", name: "X", inbox: "x@example.edu" });

    expect(res.status).toBe(404);
    expect(await prisma.mailCategory.count()).toBe(0);
  });
});

describe("delete-category (real database)", () => {
  it("cascades the links and drops sign-ins only for inboxes no other category lists", async () => {
    await run({ intent: "save-category", name: "Gone", inbox: ["solo@example.edu", "both@example.edu"] });
    const gone = await prisma.mailCategory.findFirstOrThrow();
    await run({ intent: "save-category", name: "Stays", inbox: "both@example.edu" });
    await connect("solo@example.edu");
    await connect("both@example.edu");

    const res = await run({ intent: "delete-category", id: gone.id });

    expect(res.status).toBe(200);
    expect(await prisma.mailCategory.count()).toBe(1);
    expect(await prisma.mailCategoryAccount.count()).toBe(1);
    const connected = await prisma.mailAccountConnection.findMany({ include: { account: true } });
    expect(connected.map((c) => c.account.address)).toEqual(["both@example.edu"]);
  });

  it("is a 404 for an unknown category", async () => {
    expect((await run({ intent: "delete-category", id: "missing" })).status).toBe(404);
  });
});
