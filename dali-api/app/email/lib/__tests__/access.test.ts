import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    projectAssignment: { findMany: vi.fn() },
    mailSubscription: { findMany: vi.fn() },
    mailCategory: { findMany: vi.fn() },
    mailAccount: { findMany: vi.fn(), createMany: vi.fn() },
    project: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { findFirst: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn(), getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn() }));

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolveGroupMembers } from "~/lib/groups";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { PERSONAL_MAIL_NOTICE_VERSION } from "~/email/lib/personal-notice";
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
  db.mailSubscription.findMany.mockResolvedValue([]);
  vi.mocked(isFeatureEnabled).mockResolvedValue(false);
  db.user.findUnique.mockResolvedValue({ daliEmail: "Sam@dali.dartmouth.edu" });
  db.auditLog.findFirst.mockResolvedValue(null);
});

describe("personal inbox", () => {
  const personal = { kind: "Personal", userId: "me", address: "sam@dali.dartmouth.edu" };

  it("stays out of the list while the flag is off", async () => {
    await readableMailAccounts("me", request);
    expect(db.mailAccount.createMany).not.toHaveBeenCalled();
    expect(db.mailAccount.findMany.mock.calls[0][0].where.OR).not.toContainEqual(personal);
  });

  it("lists the member's own DALI address once the flag is on", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    await readableMailAccounts("me", request);
    expect(db.mailAccount.createMany).toHaveBeenCalledWith({
      data: [{ ...personal, scopeKey: "user:me" }],
      skipDuplicates: true,
    });
    expect(db.mailAccount.findMany.mock.calls[0][0].where.OR).toContainEqual(personal);
  });

  it("refuses to connect until the current notice has been agreed to", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    expect(await expectedConnectAddress("me", { kind: "Personal" }, request)).toBeUndefined();

    db.auditLog.findFirst.mockResolvedValue({ id: "log1" });
    expect(await expectedConnectAddress("me", { kind: "Personal" }, request)).toBe("sam@dali.dartmouth.edu");
    expect(db.auditLog.findFirst.mock.calls[0][0].where).toEqual({
      userId: "me",
      action: "email.personal_consent",
      targetId: PERSONAL_MAIL_NOTICE_VERSION,
    });
  });

  it("refuses to connect with consent on record but the flag off", async () => {
    db.auditLog.findFirst.mockResolvedValue({ id: "log1" });
    expect(await expectedConnectAddress("me", { kind: "Personal" }, request)).toBeUndefined();
  });
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

  it("reads every inbox with the viewer's own sign-in, never the account's", async () => {
    db.mailSubscription.findMany.mockResolvedValue([]);
    db.mailAccount.findMany.mockResolvedValue([
      { id: "a1", kind: "Shared", oauthTokens: "legacy-team-token", syncError: null, connections: [], archives: [] },
      {
        id: "a2",
        kind: "Shared",
        oauthTokens: null,
        syncError: null,
        connections: [{ id: "c2", oauthTokens: "my-token", syncError: null }],
        archives: [],
      },
      { id: "p1", kind: "Project", oauthTokens: "legacy-team-token", syncError: null, connections: [], archives: [{ userId: "me" }] },
    ]);
    const [a1, a2, p1] = await readableMailAccounts("me", request);
    expect(a1).toMatchObject({ oauthTokens: null, connectionId: null, archived: false });
    expect(a2).toMatchObject({ oauthTokens: "my-token", connectionId: "c2" });
    expect(p1).toMatchObject({ oauthTokens: null, connectionId: null, archived: true });
  });

  it("gives each current project with a project email its inbox", async () => {
    db.mailSubscription.findMany.mockResolvedValue([]);
    vi.mocked(currentTerm).mockResolvedValue({ id: "t1" } as never);
    db.projectAssignment.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.project.findMany.mockResolvedValue([{ id: "p1", calendarEmail: "DaliOS@dali.dartmouth.edu" }]);
    await readableMailAccounts("me", request);
    expect(db.mailAccount.createMany).toHaveBeenCalledWith({
      data: [{ kind: "Project", address: "dalios@dali.dartmouth.edu", scopeKey: "project:p1", projectId: "p1" }],
      skipDuplicates: true,
    });
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
      { id: "a1", kind: "Shared", address: "partners@x.edu", oauthTokens: null, syncError: null, connections: [], archives: [] },
    ]);
    expect(await expectedConnectAddress("me", { kind: "Shared", accountId: "a1" }, request)).toBe("partners@x.edu");
  });

  it("refuses a Shared inbox the person can't open", async () => {
    db.mailSubscription.findMany.mockResolvedValue([]);
    expect(await expectedConnectAddress("me", { kind: "Shared", accountId: "a1" }, request)).toBeUndefined();
  });
});
