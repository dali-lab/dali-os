import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { VW_STATUS, type VaultwardenClient, type VwMember } from "~/lib/vaultwarden";
import { provisionVaultGroup, syncProjectVault } from "~/projects/lib/vaultwarden-group-sync";

const mockPrisma = prisma as unknown as {
  project: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

const ENV = {
  VAULTWARDEN_URL: "https://vault.test",
  VAULTWARDEN_ORG_ID: "org1",
  VAULTWARDEN_CLIENT_ID: "user.bot",
  VAULTWARDEN_CLIENT_SECRET: "secret",
};

function fakeClient(over: Partial<VaultwardenClient> = {}): VaultwardenClient {
  return {
    ensureGroup: vi.fn(async (name: string) => ({ id: "g1", name, created: true })),
    getGroupDetails: vi.fn(async (id: string) => ({ id, name: "Proj", collectionIds: [] as string[] })),
    getGroupUserIds: vi.fn(async () => [] as string[]),
    updateGroup: vi.fn(async () => {}),
    listOrgMembers: vi.fn(async () => [] as VwMember[]),
    inviteMember: vi.fn(async () => {}),
    ...over,
  };
}

beforeEach(() => {
  Object.assign(process.env, ENV);
  mockPrisma.project = { findUnique: vi.fn(), update: vi.fn() };
});
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k as keyof typeof ENV];
  vi.clearAllMocks();
});

describe("provisionVaultGroup", () => {
  it("happy path: ensures group, invites a non-member, PUTs the union, grants collection, reports pending + missing", async () => {
    const client = fakeClient({
      // First list (pre-invite) knows the two existing members; after inviting
      // c@, the re-list also returns the new Invited row.
      listOrgMembers: vi
        .fn()
        .mockResolvedValueOnce([
          { id: "m1", email: "a@dali.dartmouth.edu", status: VW_STATUS.Confirmed },
          { id: "m2", email: "b@dali.dartmouth.edu", status: VW_STATUS.Accepted },
        ])
        .mockResolvedValueOnce([
          { id: "m1", email: "a@dali.dartmouth.edu", status: VW_STATUS.Confirmed },
          { id: "m2", email: "b@dali.dartmouth.edu", status: VW_STATUS.Accepted },
          { id: "m3", email: "c@dali.dartmouth.edu", status: VW_STATUS.Invited },
        ]),
    });
    const onGroupEnsured = vi.fn(async () => {});

    const r = await provisionVaultGroup({
      projectId: "p1",
      projectName: "Proj",
      boundGroupId: null,
      collectionId: "col1",
      roster: [
        { name: "Ada Byte", email: "a@dali.dartmouth.edu" },
        { name: "Grace Hop", email: "b@dali.dartmouth.edu" },
        { name: "New Person", email: "c@dali.dartmouth.edu" },
        { name: "No Email", email: null },
      ],
      onGroupEnsured,
      client,
    });

    expect(r.status).toBe("ok");
    expect(r.groupCreated).toBe(true);
    expect(onGroupEnsured).toHaveBeenCalledWith("g1");
    expect(client.inviteMember).toHaveBeenCalledTimes(1);
    expect(client.inviteMember).toHaveBeenCalledWith("c@dali.dartmouth.edu", "g1");
    expect(r.invited).toBe(1);
    expect(r.membersEnsured).toBe(3);
    // Accepted (b) + Invited (c) are not Confirmed → awaiting confirmation.
    expect(r.membersUnconfirmed.sort()).toEqual(["Grace Hop", "New Person"]);
    expect(r.missingEmails).toEqual(["No Email"]);
    expect(r.collectionGranted).toBe(true);
    // Single add-only PUT with all three member ids and the collection.
    expect(client.updateGroup).toHaveBeenCalledWith("g1", {
      name: "Proj",
      collectionIds: ["col1"],
      userIds: ["m1", "m2", "m3"],
    });
  });

  it("is add-only: unions roster onto the group's current members, never dropping them", async () => {
    const client = fakeClient({
      getGroupUserIds: vi.fn(async () => ["existing1", "existing2"]),
      listOrgMembers: vi.fn(async () => [
        { id: "m1", email: "a@dali.dartmouth.edu", status: VW_STATUS.Confirmed },
      ]),
    });

    await provisionVaultGroup({
      projectId: "p1",
      projectName: "Proj",
      boundGroupId: "g1",
      collectionId: null,
      roster: [{ name: "Ada", email: "a@dali.dartmouth.edu" }],
      client,
    });

    expect(client.updateGroup).toHaveBeenCalledWith("g1", {
      name: "Proj",
      collectionIds: [],
      userIds: ["existing1", "existing2", "m1"],
    });
  });

  it("does not create a group (or call onGroupEnsured) when a group id is bound", async () => {
    const client = fakeClient({
      getGroupDetails: vi.fn(async (id: string) => ({ id, name: "Proj", collectionIds: ["colX"] })),
    });
    const onGroupEnsured = vi.fn(async () => {});

    const r = await provisionVaultGroup({
      projectId: "p1",
      projectName: "Proj",
      boundGroupId: "bound-g",
      collectionId: "col1",
      roster: [],
      onGroupEnsured,
      client,
    });

    expect(client.ensureGroup).not.toHaveBeenCalled();
    expect(onGroupEnsured).not.toHaveBeenCalled();
    expect(r.groupCreated).toBe(false);
    // Existing collection grant is preserved (union), plus the new one.
    expect(client.updateGroup).toHaveBeenCalledWith("bound-g", {
      name: "Proj",
      collectionIds: ["colX", "col1"],
      userIds: [],
    });
  });

  it("errors (no invite/PUT) when a bound group id doesn't resolve", async () => {
    const client = fakeClient({
      getGroupDetails: vi.fn(async () => null),
    });

    const r = await provisionVaultGroup({
      projectId: "p1",
      projectName: "Proj",
      boundGroupId: "stale",
      collectionId: null,
      roster: [{ name: "Ada", email: "a@dali.dartmouth.edu" }],
      client,
    });

    expect(r.status).toBe("error");
    expect(r.message).toContain("not found");
    expect(client.inviteMember).not.toHaveBeenCalled();
    expect(client.updateGroup).not.toHaveBeenCalled();
  });

  it("isolates a failing invite — records a member error, still PUTs the rest, status error", async () => {
    const client = fakeClient({
      listOrgMembers: vi.fn(async () => [
        { id: "m1", email: "a@dali.dartmouth.edu", status: VW_STATUS.Confirmed },
      ]),
      inviteMember: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    const r = await provisionVaultGroup({
      projectId: "p1",
      projectName: "Proj",
      boundGroupId: "g1",
      collectionId: null,
      roster: [
        { name: "Ada", email: "a@dali.dartmouth.edu" },
        { name: "New", email: "new@dali.dartmouth.edu" },
      ],
      client,
    });

    expect(r.status).toBe("error");
    expect(r.memberErrors).toHaveLength(1);
    expect(r.memberErrors[0].email).toBe("new@dali.dartmouth.edu");
    // The resolvable member is still ensured / PUT.
    expect(r.membersEnsured).toBe(1);
    expect(client.updateGroup).toHaveBeenCalled();
  });
});

describe("syncProjectVault", () => {
  it("skips (no client calls) when Vaultwarden is not configured", async () => {
    for (const k of Object.keys(ENV)) delete process.env[k as keyof typeof ENV];
    const client = fakeClient();

    const r = await syncProjectVault("p1", "term-26x", client);
    expect(r.status).toBe("skipped");
    expect(r.message).toContain("not configured");
    expect(client.ensureGroup).not.toHaveBeenCalled();
  });

  it("dedupes a user assigned in two domains and persists the ensured group id", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({
      id: "p1",
      name: "Proj",
      vaultwardenGroupId: null,
      vaultwardenCollectionId: null,
      assignments: [
        { user: { id: "u1", firstName: "Ada", lastName: "Byte", daliEmail: "a@dali.dartmouth.edu" } },
        { user: { id: "u1", firstName: "Ada", lastName: "Byte", daliEmail: "a@dali.dartmouth.edu" } },
      ],
    });
    const client = fakeClient({
      listOrgMembers: vi.fn(async () => [
        { id: "m1", email: "a@dali.dartmouth.edu", status: VW_STATUS.Confirmed },
      ]),
    });

    const r = await syncProjectVault("p1", "term-26x", client);

    expect(r.status).toBe("ok");
    expect(r.membersEnsured).toBe(1);
    expect(client.inviteMember).not.toHaveBeenCalled();
    // Newly ensured group id persisted back to the project.
    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { vaultwardenGroupId: "g1" },
    });
  });
});
