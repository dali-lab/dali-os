import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    projectAssignment: { findMany: vi.fn() },
    mailSubscription: { findMany: vi.fn() },
    mailCategory: { findMany: vi.fn() },
    mailAccount: { findMany: vi.fn() },
    project: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn() }));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn() }));

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolveGroupMembers } from "~/lib/groups";
import { categoriesForUser, expectedConnectAddress, readableMailAccounts } from "~/email/lib/access.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const request = new Request("http://localhost/email");

const category = (o: Partial<{ audienceUserIds: string[]; audienceGroupIds: string[]; accountIds: string[] }>) => ({
  audienceUserIds: o.audienceUserIds ?? [],
  audienceGroupIds: o.audienceGroupIds ?? [],
  accounts: (o.accountIds ?? []).map((accountId) => ({ accountId })),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentTerm).mockResolvedValue(null as never);
  vi.mocked(resolveGroupMembers).mockResolvedValue([]);
  db.mailAccount.findMany.mockResolvedValue([]);
});

describe("readableMailAccounts", () => {
  it("opens a subscribed category's inboxes to someone in its audience, directly or through a group", async () => {
    db.mailSubscription.findMany.mockResolvedValue([
      { category: category({ audienceUserIds: ["me"], accountIds: ["a1"] }) },
      { category: category({ audienceGroupIds: ["g1"], accountIds: ["a2"] }) },
    ]);
    vi.mocked(resolveGroupMembers).mockResolvedValue(["me"]);
    await readableMailAccounts("me", request);
    const where = db.mailAccount.findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ kind: "Shared", id: { in: ["a1", "a2"] } });
  });

  it("ignores a subscription once the person has left the audience", async () => {
    db.mailSubscription.findMany.mockResolvedValue([
      { category: category({ audienceUserIds: ["someone-else"], accountIds: ["a1"] }) },
    ]);
    await readableMailAccounts("me", request);
    const where = db.mailAccount.findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ kind: "Shared", id: { in: [] } });
  });

  it("reads a Shared inbox with the viewer's own sign-in, never the account's", async () => {
    db.mailSubscription.findMany.mockResolvedValue([]);
    db.mailAccount.findMany.mockResolvedValue([
      { id: "a1", kind: "Shared", oauthTokens: "legacy-team-token", syncError: null, connections: [] },
      {
        id: "a2",
        kind: "Shared",
        oauthTokens: null,
        syncError: null,
        connections: [{ id: "c2", oauthTokens: "my-token", syncError: null }],
      },
      { id: "p1", kind: "Personal", oauthTokens: "personal-token", syncError: null, connections: [] },
    ]);
    const [a1, a2, p1] = await readableMailAccounts("me", request);
    expect(a1).toMatchObject({ oauthTokens: null, connectionId: null });
    expect(a2).toMatchObject({ oauthTokens: "my-token", connectionId: "c2" });
    expect(p1).toMatchObject({ oauthTokens: "personal-token", connectionId: null });
  });
});

describe("categoriesForUser", () => {
  it("lists only categories the person may subscribe to, resolving each group once", async () => {
    db.mailCategory.findMany.mockResolvedValue([
      { id: "c1", audienceUserIds: [], audienceGroupIds: ["core"] },
      { id: "c2", audienceUserIds: [], audienceGroupIds: ["core"] },
      { id: "c3", audienceUserIds: ["other"], audienceGroupIds: [] },
    ]);
    vi.mocked(resolveGroupMembers).mockResolvedValue(["me"]);
    const visible = await categoriesForUser("me");
    expect(visible.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(resolveGroupMembers).toHaveBeenCalledTimes(1);
  });
});

describe("expectedConnectAddress", () => {
  it("lets a subscriber sign in to a Shared inbox as that inbox", async () => {
    db.mailSubscription.findMany.mockResolvedValue([]);
    db.mailAccount.findMany.mockResolvedValue([
      { id: "a1", kind: "Shared", address: "partners@x.edu", oauthTokens: null, syncError: null, connections: [] },
    ]);
    expect(await expectedConnectAddress("me", { kind: "Shared", accountId: "a1" }, request)).toBe("partners@x.edu");
  });

  it("refuses a Shared inbox the person can't open", async () => {
    db.mailSubscription.findMany.mockResolvedValue([]);
    expect(await expectedConnectAddress("me", { kind: "Shared", accountId: "a1" }, request)).toBeUndefined();
  });
});
