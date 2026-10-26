import { describe, expect, it } from "vitest";
import {
  collectionLabel,
  projectVault,
  syncedEmails,
  vaultGroupExternalId,
  vaultGroupOptions,
  type RosterPerson,
} from "../vault-scope";
import type { VaultInventory, VaultMember } from "../types";

const member = (id: string, email: string, over: Partial<VaultMember> = {}): VaultMember => ({
  id,
  email,
  name: null,
  status: 2,
  type: 2,
  twoFactorEnabled: true,
  ...over,
});

const inv: VaultInventory = {
  orgId: "org",
  members: [
    member("m1", "ada@example.edu"),
    member("m2", "grace@example.edu", { status: 1 }),
    member("m3", "alan@example.edu", { status: 0 }),
    member("m4", "other@example.edu"),
  ],
  groups: [
    { id: "g1", name: "Ultrasound", externalId: null, memberIds: ["m1", "m2", "m3", "gone"], collectionIds: ["c1", "c-gone"] },
    { id: "g2", name: "Other", externalId: "x", memberIds: ["m4"], collectionIds: [] },
  ],
  collections: [{ id: "c1", externalId: "ultrasound-secrets", itemCount: 4, recentUses: 9 }],
};

const roster: RosterPerson[] = [
  { userId: "u1", name: "Ada", email: "ada@example.edu" },
  { userId: "u2", name: "Grace", email: "GRACE@example.edu" },
  { userId: "u5", name: "Katherine", email: "katherine@example.edu" },
  { userId: "u6", name: "Mary", email: null },
];

describe("projectVault", () => {
  const v = projectVault(inv, "g1", roster)!;

  it("lists the group's members, not-staffed first, skipping ids no longer in the org", () => {
    expect(v.members.map((m) => [m.email, m.staffed])).toEqual([
      ["alan@example.edu", false],
      ["ada@example.edu", true],
      ["grace@example.edu", true],
    ]);
  });

  it("finds staffed people missing from the group", () => {
    expect(v.missing.map((p) => p.name)).toEqual(["Katherine"]);
  });

  it("reports staffed people with no DALI email", () => {
    expect(v.noEmail.map((p) => p.name)).toEqual(["Mary"]);
  });

  it("counts accepted invites waiting to be confirmed", () => {
    expect(v.awaitingConfirm).toBe(1);
  });

  it("lists only collections the org still has", () => {
    expect(v.collections.map((c) => c.id)).toEqual(["c1"]);
  });

  it("is null with no linked group, an unknown group, or no sweep", () => {
    expect(projectVault(inv, null, roster)).toBeNull();
    expect(projectVault(inv, "missing", roster)).toBeNull();
    expect(projectVault(null, "g1", roster)).toBeNull();
  });
});

describe("syncedEmails", () => {
  const v = projectVault(inv, "g1", roster)!;

  it("keeps current members and adds missing staffed people", () => {
    expect(syncedEmails(v).sort()).toEqual(
      ["ada@example.edu", "alan@example.edu", "grace@example.edu", "katherine@example.edu"].sort(),
    );
  });

  it("drops people explicitly removed, case-insensitively", () => {
    expect(syncedEmails(v, ["Alan@Example.edu"])).not.toContain("alan@example.edu");
  });

  it("never drops a not-staffed member on its own", () => {
    expect(syncedEmails(v)).toContain("alan@example.edu");
  });
});

describe("labels and ids", () => {
  it("labels a collection by its external id or a short id", () => {
    expect(collectionLabel({ id: "c1", externalId: "ultrasound-secrets" })).toBe("ultrasound-secrets");
    expect(collectionLabel({ id: "0123456789abcdef", externalId: null })).toBe("Collection 01234567");
  });

  it("keys a project's group by project id", () => {
    expect(vaultGroupExternalId("p1")).toBe("dali-project:p1");
  });

  it("offers every group", () => {
    expect(vaultGroupOptions(inv)).toEqual([
      { id: "g1", name: "Ultrasound" },
      { id: "g2", name: "Other" },
    ]);
    expect(vaultGroupOptions(null)).toEqual([]);
  });
});
