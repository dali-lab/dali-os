import { describe, it, expect, beforeEach, vi } from "vitest";

// notifySignRequest's default "skip already-notified for this binding+version"
// behaviour — so re-issuing a term's agreements only reaches newly-added,
// still-unsigned members, while a new version or an explicit `force` re-nudges.

// Hoisted so the vi.mock factories below can reference them.
const h = vi.hoisted(() => ({
  notify: vi.fn(),
  listMembers: vi.fn(),
  store: [] as { bindingId: string; versionId: string; signerUserId: string }[],
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
    signRequestNotification: {
      findMany: vi.fn(
        async ({ where }: { where: { bindingId: string; versionId: string; signerUserId: { in: string[] } } }) =>
          h.store
            .filter(
              (r) =>
                r.bindingId === where.bindingId &&
                r.versionId === where.versionId &&
                where.signerUserId.in.includes(r.signerUserId),
            )
            .map((r) => ({ signerUserId: r.signerUserId })),
      ),
      createMany: vi.fn(async ({ data }: { data: typeof h.store }) => {
        for (const d of data) {
          if (
            !h.store.some(
              (r) => r.bindingId === d.bindingId && r.versionId === d.versionId && r.signerUserId === d.signerUserId,
            )
          ) {
            h.store.push(d);
          }
        }
        return { count: data.length };
      }),
    },
  },
}));

import { notifySignRequest } from "~/signing/lib/notify.server";

// The userIds from the most recent notify() call (empty if none).
function lastRecipients(): string[] {
  const call = h.notify.mock.calls.at(-1);
  return call ? (call[0].recipients as { userId: string }[]).map((r) => r.userId).sort() : [];
}

beforeEach(() => {
  h.notify.mockClear();
  h.listMembers.mockReset();
  h.store.length = 0;
  h.signatures.length = 0;
  h.state.bindingRow = {
    id: "b1",
    versionId: "v1",
    termId: "t1",
    document: { name: "Doc", gateScope: "App", audience: "Members", audienceGroupId: null },
  };
});

describe("notifySignRequest", () => {
  it("first issue notifies all unsigned audience and records them", async () => {
    h.listMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    await notifySignRequest("b1");
    expect(lastRecipients()).toEqual(["u1", "u2"]);
    expect(h.store.map((r) => r.signerUserId).sort()).toEqual(["u1", "u2"]);
  });

  it("re-issue of the same version skips already-notified members", async () => {
    h.listMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    await notifySignRequest("b1");
    h.notify.mockClear();
    await notifySignRequest("b1");
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("re-issue notifies only newly-added audience members", async () => {
    h.listMembers.mockResolvedValue([{ id: "u1" }]);
    await notifySignRequest("b1");
    h.notify.mockClear();
    h.listMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    await notifySignRequest("b1");
    expect(lastRecipients()).toEqual(["u2"]);
  });

  it("force re-nudges everyone still outstanding", async () => {
    h.listMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    await notifySignRequest("b1");
    h.notify.mockClear();
    await notifySignRequest("b1", { force: true });
    expect(lastRecipients()).toEqual(["u1", "u2"]);
  });

  it("a new version in force resets the set — everyone is notified again", async () => {
    h.listMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    await notifySignRequest("b1");
    h.notify.mockClear();
    h.state.bindingRow!.versionId = "v2";
    await notifySignRequest("b1");
    expect(lastRecipients()).toEqual(["u1", "u2"]);
  });

  it("skips members who already signed the in-force version", async () => {
    h.listMembers.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    h.signatures.push({ signerUserId: "u1", versionId: "v1" });
    await notifySignRequest("b1");
    expect(lastRecipients()).toEqual(["u2"]);
  });
});
