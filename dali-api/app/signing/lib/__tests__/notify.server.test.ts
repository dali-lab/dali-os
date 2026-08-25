import { describe, it, expect, beforeEach, vi } from "vitest";

// notifySignRequest now delegates dedup to notify()'s per-recipient dedupKey:
// it passes a forever key `signing.request:{binding}:{version}:{signer}` (or no
// key when force), and notify() collides re-fires on the Notification unique
// constraint. These tests assert the keys, not a pre-filter (that moved into
// notify(), which is mocked here). The signed-member filter still lives here.

const h = vi.hoisted(() => ({
  notify: vi.fn(),
  listMembers: vi.fn(),
  signatures: [] as { signerUserId: string; versionId: string }[],
  state: {
    bindingRow: null as null | {
      id: string;
      versionId: string;
      termId: string | null;
      document: { name: string; gateScope: string; audience: string; audienceGroupId: string | null };
    },
  },
}));

vi.mock("~/lib/notify.server", () => ({ notify: h.notify }));
vi.mock("~/signing/lib/audiences", () => ({ AUDIENCE_RESOLVERS: { Members: { listMembers: h.listMembers } } }));
vi.mock("~/lib/db", () => ({
  prisma: {
    signingBinding: { findUnique: vi.fn(async () => h.state.bindingRow) },
    signingSignature: {
      findMany: vi.fn(async ({ where }: { where: { versionId: string } }) =>
        h.signatures.filter((s) => s.versionId === where.versionId).map((s) => ({ signerUserId: s.signerUserId })),
      ),
    },
  },
}));

import { notifySignRequest } from "~/signing/lib/notify.server";

// The recipients (userId + dedupKey) from the most recent notify() call.
function lastRecipients(): { userId: string; dedupKey: string | null }[] {
  const call = h.notify.mock.calls.at(-1);
  if (!call) return [];
  return (call[0].recipients as { userId: string; dedupKey: string | null }[])
    .map((r) => ({ userId: r.userId, dedupKey: r.dedupKey }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

beforeEach(() => {
  h.notify.mockClear();
  h.listMembers.mockReset();
  h.signatures.length = 0;
  h.state.bindingRow = {
    id: "b1",
    versionId: "v1",
    termId: "t1",
    document: { name: "Doc", gateScope: "App", audience: "Members", audienceGroupId: null },
  };
});

describe("notifySignRequest", () => {
  it("notifies all unsigned audience with a per-signer forever key", async () => {
    h.listMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    await notifySignRequest("b1");
    expect(lastRecipients()).toEqual([
      { userId: "u1", dedupKey: "signing.request:b1:v1:u1" },
      { userId: "u2", dedupKey: "signing.request:b1:v1:u2" },
    ]);
  });

  it("keys re-issues the same, so notify() dedups them for the in-force version", async () => {
    h.listMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    await notifySignRequest("b1");
    await notifySignRequest("b1");
    // Same forever keys on the re-issue — the actual skip happens in notify().
    expect(lastRecipients()).toEqual([
      { userId: "u1", dedupKey: "signing.request:b1:v1:u1" },
      { userId: "u2", dedupKey: "signing.request:b1:v1:u2" },
    ]);
  });

  it("force re-nudges everyone outstanding with no dedupKey", async () => {
    h.listMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    await notifySignRequest("b1", { force: true });
    expect(lastRecipients()).toEqual([
      { userId: "u1", dedupKey: null },
      { userId: "u2", dedupKey: null },
    ]);
  });

  it("a new version in force keys with the new versionId (everyone re-notified)", async () => {
    h.listMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    h.state.bindingRow!.versionId = "v2";
    await notifySignRequest("b1");
    expect(lastRecipients()).toEqual([
      { userId: "u1", dedupKey: "signing.request:b1:v2:u1" },
      { userId: "u2", dedupKey: "signing.request:b1:v2:u2" },
    ]);
  });

  it("skips members who already signed the in-force version", async () => {
    h.listMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    h.signatures.push({ signerUserId: "u1", versionId: "v1" });
    await notifySignRequest("b1");
    expect(lastRecipients()).toEqual([
      { userId: "u2", dedupKey: "signing.request:b1:v1:u2" },
    ]);
  });

  it("does not notify when everyone eligible has signed", async () => {
    h.listMembers.mockResolvedValue([{ id: "u1" }]);
    h.signatures.push({ signerUserId: "u1", versionId: "v1" });
    await notifySignRequest("b1");
    expect(h.notify).not.toHaveBeenCalled();
  });
});
