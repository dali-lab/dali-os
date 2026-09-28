import { describe, it, expect, beforeEach, vi } from "vitest";

// Unit tests for the mentee-countersignature gate (menteeCountersignState) and
// the countersign-request notification (notifyCountersignRequest). Prisma, the
// feature flag, and currentTerm are mocked so the predicate + dedup logic are
// exercised in isolation.

const h = vi.hoisted(() => ({
  // menteeCountersignState inputs
  binding: null as unknown,
  pairs: [] as { mentorUserId: string }[],
  mentorSig: null as null | { id: string },
  flagOn: true,
  term: { sortKey: 10 } as null | { sortKey: number },
  // notifyCountersignRequest inputs
  notifyBinding: null as unknown,
  notifyPairs: [] as { menteeUserId: string }[],
  countersigned: [] as { signerUserId: string }[],
  notify: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  prisma: {
    signingBinding: {
      findUnique: vi.fn(async ({ select }: { select: Record<string, unknown> }) =>
        // notifyCountersignRequest selects `id`; menteeCountersignState selects `document`.
        "id" in select ? h.notifyBinding : h.binding,
      ),
    },
    mentorshipPair: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        "menteeUserId" in where ? h.pairs : h.notifyPairs,
      ),
    },
    signingSignature: {
      findFirst: vi.fn(async () => h.mentorSig),
      findMany: vi.fn(async () => h.countersigned),
    },
  },
}));

vi.mock("~/lib/feature-flags.server", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isFeatureEnabledForEveryone: vi.fn(async () => h.flagOn),
}));

vi.mock("~/lib/roles", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  currentTerm: vi.fn(async () => h.term),
}));

vi.mock("~/lib/notify.server", () => ({ notify: h.notify }));

import { menteeCountersignState } from "~/signing/lib/state.server";
import { notifyCountersignRequest } from "~/signing/lib/notify.server";

beforeEach(() => {
  // Default happy path for the gate → "owed": opt-in doc, term-scoped, current
  // term, the user is a mentee, and one of their mentors signed the in-force
  // version, and they have not countersigned it yet.
  h.binding = {
    versionId: "v1",
    termId: "t1",
    document: { requiresMenteeCountersign: true, gateScope: "App" },
    term: { sortKey: 10 },
    signatures: [], // this user's own mentee signatures on the binding
  };
  h.pairs = [{ mentorUserId: "m1" }];
  h.mentorSig = { id: "sig1" };
  h.flagOn = true;
  h.term = { sortKey: 10 };

  h.notifyBinding = {
    id: "b1",
    versionId: "v1",
    termId: "t1",
    document: { name: "Mentorship Agreement", gateScope: "App", requiresMenteeCountersign: true },
  };
  h.notifyPairs = [{ menteeUserId: "mentee1" }, { menteeUserId: "mentee2" }];
  h.countersigned = [];
  h.notify.mockClear();
});

describe("menteeCountersignState", () => {
  it("returns 'owed' when a mentor has signed and the mentee has not", async () => {
    expect(await menteeCountersignState("mentee1", "b1")).toBe("owed");
  });

  it("returns 'signed' when the mentee already countersigned the in-force version — checked FIRST", async () => {
    (h.binding as { signatures: unknown[] }).signatures = [{ versionId: "v1" }];
    // Even with the flag off / doc opted-out, an existing countersignature wins
    // so a later re-finalize or mentor un-sign can't re-gate them.
    h.flagOn = false;
    expect(await menteeCountersignState("mentee1", "b1")).toBe("signed");
  });

  it("returns 'not_owed' when the binding does not exist", async () => {
    h.binding = null;
    expect(await menteeCountersignState("mentee1", "missing")).toBe("not_owed");
  });

  it("returns 'not_owed' when the document does not require countersignatures", async () => {
    (h.binding as { document: { requiresMenteeCountersign: boolean } }).document.requiresMenteeCountersign = false;
    expect(await menteeCountersignState("mentee1", "b1")).toBe("not_owed");
  });

  it("returns 'not_owed' when the feature flag is off", async () => {
    h.flagOn = false;
    expect(await menteeCountersignState("mentee1", "b1")).toBe("not_owed");
  });

  it("returns 'not_owed' when the user is not a mentee this term", async () => {
    h.pairs = [];
    expect(await menteeCountersignState("mentee1", "b1")).toBe("not_owed");
  });

  it("returns 'not_owed' when none of the user's mentors have signed yet", async () => {
    h.mentorSig = null;
    expect(await menteeCountersignState("mentee1", "b1")).toBe("not_owed");
  });

  it("returns 'not_owed' for a past term's binding", async () => {
    h.term = { sortKey: 11 }; // current term is later than the binding's term
    expect(await menteeCountersignState("mentee1", "b1")).toBe("not_owed");
  });
});

function lastRecipients(): { userId: string; dedupKey: string | null }[] {
  const call = h.notify.mock.calls.at(-1);
  if (!call) return [];
  return (call[0].recipients as { userId: string; dedupKey: string | null }[])
    .map((r) => ({ userId: r.userId, dedupKey: r.dedupKey }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

describe("notifyCountersignRequest", () => {
  it("asks all of a mentor's mentees, keyed per (binding, version, mentee)", async () => {
    await notifyCountersignRequest("b1", "m1");
    expect(lastRecipients()).toEqual([
      { userId: "mentee1", dedupKey: "countersign.request:b1:v1:mentee1" },
      { userId: "mentee2", dedupKey: "countersign.request:b1:v1:mentee2" },
    ]);
  });

  it("skips mentees who already countersigned the in-force version", async () => {
    h.countersigned = [{ signerUserId: "mentee1" }];
    await notifyCountersignRequest("b1", "m1");
    expect(lastRecipients()).toEqual([
      { userId: "mentee2", dedupKey: "countersign.request:b1:v1:mentee2" },
    ]);
  });

  it("no-ops when the feature flag is off", async () => {
    h.flagOn = false;
    await notifyCountersignRequest("b1", "m1");
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("no-ops when the document does not opt in", async () => {
    (h.notifyBinding as { document: { requiresMenteeCountersign: boolean } }).document.requiresMenteeCountersign = false;
    await notifyCountersignRequest("b1", "m1");
    expect(h.notify).not.toHaveBeenCalled();
  });
});
