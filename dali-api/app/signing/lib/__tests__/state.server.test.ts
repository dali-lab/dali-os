import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    dALIMember: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    term: { findUnique: vi.fn() },
    signingBinding: { findMany: vi.fn(), findUnique: vi.fn() },
    signingSignature: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    mentorshipPair: { findMany: vi.fn() },
  },
  currentTerm: vi.fn(),
  isUserActiveInTerm: vi.fn(),
  resolveGroupMembers: vi.fn(),
  isNewMemberCohort: vi.fn(),
  isStaffedInTerm: vi.fn(),
  isStaffedMentorInTerm: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: h.prisma }));
vi.mock("~/lib/roles", () => ({ currentTerm: h.currentTerm }));
vi.mock("~/lib/groups.server", () => ({
  isUserActiveInTerm: h.isUserActiveInTerm,
  resolveGroupMembers: h.resolveGroupMembers,
  resolveDynamicQuery: vi.fn(),
}));
vi.mock("~/hiring/lib/new-member-cohort.server", () => ({ isNewMemberCohort: h.isNewMemberCohort }));
vi.mock("~/signing/lib/staffing-audience.server", () => ({
  isStaffedInTerm: h.isStaffedInTerm,
  isStaffedMentorInTerm: h.isStaffedMentorInTerm,
  partitionStaffedMembers: vi.fn(),
  listStaffedMentors: vi.fn(),
}));

import {
  getSignerCohorts,
  getSignerCohortsForBinding,
  listOutstandingBindings,
  countOutstandingBindings,
  getAppGateOutstanding,
  listMySignedDocuments,
  getBindingStateForUser,
  getSignedCopyBody,
  menteeCountersignState,
} from "~/signing/lib/state.server";

const CURRENT = { id: "t-now", sortKey: 10 };
const NO = { isMember: false, isStaffedThisTerm: false, isNewStaffed: false, isMentor: false, isActiveThisTerm: false };

type Sig = { versionId: string; roleKey: string };
function binding(over: Record<string, unknown> = {}) {
  return {
    id: "b1",
    versionId: "v1",
    termId: "t-now" as string | null,
    term: CURRENT as { id: string; sortKey: number } | null,
    document: {
      id: "d1",
      name: "Member Agreement",
      audience: "Members",
      audienceGroupId: null as string | null,
      requiresMenteeCountersign: false,
    },
    signatures: [] as Sig[],
    ...over,
  };
}

function setUser(opts: { member?: boolean; status?: string; staff?: boolean } = {}) {
  h.prisma.dALIMember.findUnique.mockResolvedValue(opts.member === false ? null : { userId: "u1" });
  h.prisma.user.findUnique.mockResolvedValue({
    membershipStatus: opts.status ?? "Active",
    adminMembership: opts.staff ? { isStaff: true } : null,
  });
}

// term-scoped staffing facts, keyed by termId
function setStaffing(byTerm: Record<string, { staffed?: boolean; mentor?: boolean; active?: boolean }>, newHire = false) {
  h.isStaffedInTerm.mockImplementation(async (_u: string, t: string) => !!byTerm[t]?.staffed);
  h.isStaffedMentorInTerm.mockImplementation(async (_u: string, t: string) => !!byTerm[t]?.mentor);
  h.isUserActiveInTerm.mockImplementation(async (_u: string, t: string) => !!byTerm[t]?.active);
  h.isNewMemberCohort.mockResolvedValue(newHire);
}

beforeEach(() => {
  vi.resetAllMocks();
  setUser();
  h.currentTerm.mockResolvedValue(CURRENT);
  setStaffing({ "t-now": { staffed: true } });
  h.resolveGroupMembers.mockResolvedValue([]);
  h.prisma.signingBinding.findMany.mockResolvedValue([]);
  h.prisma.mentorshipPair.findMany.mockResolvedValue([]);
  h.prisma.signingSignature.findMany.mockResolvedValue([]);
});

describe("getSignerCohorts", () => {
  it("full-time staff are exempt from every cohort, even when staffed", async () => {
    setUser({ staff: true });
    expect(await getSignerCohorts("u1")).toEqual(NO);
    expect(h.isStaffedInTerm).not.toHaveBeenCalled();
  });

  it("alumni and non-DALIMembers are not members", async () => {
    setUser({ status: "Alumni" });
    expect((await getSignerCohorts("u1")).isMember).toBe(false);
    setUser({ member: false });
    expect((await getSignerCohorts("u1")).isMember).toBe(false);
  });

  it("with no current term only the membership flag survives", async () => {
    h.currentTerm.mockResolvedValue(null);
    expect(await getSignerCohorts("u1")).toEqual({ ...NO, isMember: true });
  });

  it("a staffed new hire owes the new-member cohort; a staffed non-hire does not", async () => {
    setStaffing({ "t-now": { staffed: true, mentor: true, active: true } }, true);
    expect(await getSignerCohorts("u1")).toEqual({
      isMember: true,
      isStaffedThisTerm: true,
      isNewStaffed: true,
      isMentor: true,
      isActiveThisTerm: true,
    });
    setStaffing({ "t-now": { staffed: true } }, false);
    expect((await getSignerCohorts("u1")).isNewStaffed).toBe(false);
  });

  it("an accepted hire who is not staffed this term is not new-staffed", async () => {
    setStaffing({ "t-now": { staffed: false } }, true);
    const c = await getSignerCohorts("u1");
    expect(c.isNewStaffed).toBe(false);
    expect(c.isStaffedThisTerm).toBe(false);
  });
});

describe("getSignerCohortsForBinding", () => {
  it("an app-scoped binding uses the current term", async () => {
    await getSignerCohortsForBinding("u1", null);
    expect(h.isStaffedInTerm).toHaveBeenCalledWith("u1", "t-now");
    expect(h.prisma.term.findUnique).not.toHaveBeenCalled();
  });

  it("a term-scoped binding is gated on its own (upcoming) term, not today's", async () => {
    h.prisma.term.findUnique.mockResolvedValue({ id: "t-next", sortKey: 11 });
    setStaffing({ "t-now": { staffed: false }, "t-next": { staffed: true } });
    const c = await getSignerCohortsForBinding("u1", "t-next");
    expect(c.isStaffedThisTerm).toBe(true);
    expect(h.isStaffedInTerm).toHaveBeenCalledWith("u1", "t-next");
  });

  it("staff are exempt and an unknown term leaves only membership", async () => {
    setUser({ staff: true });
    expect(await getSignerCohortsForBinding("u1", "t-next")).toEqual(NO);
    setUser();
    h.prisma.term.findUnique.mockResolvedValue(null);
    expect(await getSignerCohortsForBinding("u1", "gone")).toEqual({ ...NO, isMember: true });
  });
});

describe("listOutstandingBindings", () => {
  it("only asks for published, non-archived, App-gated bindings", async () => {
    await listOutstandingBindings("u1");
    expect(h.prisma.signingBinding.findMany.mock.calls[0][0].where).toEqual({
      document: { archivedAt: null, gateScope: "App" },
      version: { publishedAt: { not: null } },
    });
  });

  it("staff owe nothing and no query is made", async () => {
    setUser({ staff: true });
    expect(await listOutstandingBindings("u1")).toEqual([]);
    expect(h.prisma.signingBinding.findMany).not.toHaveBeenCalled();
  });

  it("lists an unsigned in-audience binding as a member obligation", async () => {
    h.prisma.signingBinding.findMany.mockResolvedValue([binding()]);
    expect(await listOutstandingBindings("u1")).toEqual([
      { bindingId: "b1", documentId: "d1", documentName: "Member Agreement", versionId: "v1", role: "member" },
    ]);
  });

  it("drops a binding the user signed at the in-force version, but not one signed at an older version", async () => {
    h.prisma.signingBinding.findMany.mockResolvedValue([
      binding({ id: "signed", signatures: [{ versionId: "v1", roleKey: "member" }] }),
      binding({ id: "stale", signatures: [{ versionId: "v0", roleKey: "member" }] }),
    ]);
    const out = await listOutstandingBindings("u1");
    expect(out.map((o) => o.bindingId)).toEqual(["stale"]);
  });

  it("a mentee countersignature does not satisfy the member obligation", async () => {
    h.prisma.signingBinding.findMany.mockResolvedValue([
      binding({ signatures: [{ versionId: "v1", roleKey: "mentee" }] }),
    ]);
    expect((await listOutstandingBindings("u1")).map((o) => o.role)).toEqual(["member"]);
  });

  it("filters by audience: returning members skip a New-members agreement, new hires get it", async () => {
    const newDoc = binding({ document: { ...binding().document, audience: "NewMembers" } });
    h.prisma.signingBinding.findMany.mockResolvedValue([newDoc]);
    expect(await listOutstandingBindings("u1")).toEqual([]);
    setStaffing({ "t-now": { staffed: true } }, true);
    expect(await listOutstandingBindings("u1")).toHaveLength(1);
  });

  it("a fixed Group audience requires membership in that group", async () => {
    const g = binding({ document: { ...binding().document, audience: "Group", audienceGroupId: "g1" } });
    h.prisma.signingBinding.findMany.mockResolvedValue([g]);
    expect(await listOutstandingBindings("u1")).toEqual([]);
    h.resolveGroupMembers.mockResolvedValue(["u1"]);
    expect(await listOutstandingBindings("u1")).toHaveLength(1);
    expect(h.resolveGroupMembers).toHaveBeenCalledWith("g1");
  });

  it("a term-group Group audience gates on being active this term", async () => {
    const g = binding({ document: { ...binding().document, audience: "Group" } });
    h.prisma.signingBinding.findMany.mockResolvedValue([g]);
    expect(await listOutstandingBindings("u1")).toEqual([]);
    setStaffing({ "t-now": { active: true } });
    expect(await listOutstandingBindings("u1")).toHaveLength(1);
  });

  it("a past term's binding never blocks, an upcoming one is gated on that term's staffing", async () => {
    const past = binding({ id: "past", termId: "t-old", term: { id: "t-old", sortKey: 9 } });
    const next = binding({ id: "next", termId: "t-next", term: { id: "t-next", sortKey: 11 } });
    h.prisma.signingBinding.findMany.mockResolvedValue([past, next]);
    setStaffing({ "t-now": { staffed: false }, "t-next": { staffed: true } });
    expect((await listOutstandingBindings("u1")).map((o) => o.bindingId)).toEqual(["next"]);
  });

  it("an upcoming term's binding is skipped when the user is not staffed in that term", async () => {
    const next = binding({ id: "next", termId: "t-next", term: { id: "t-next", sortKey: 11 } });
    h.prisma.signingBinding.findMany.mockResolvedValue([next]);
    setStaffing({ "t-now": { staffed: true }, "t-next": { staffed: false } });
    expect(await listOutstandingBindings("u1")).toEqual([]);
  });

  it("with no current term only app-scoped bindings can be owed, and they gate on no cohort", async () => {
    h.currentTerm.mockResolvedValue(null);
    h.prisma.signingBinding.findMany.mockResolvedValue([
      binding({ id: "scoped" }),
      binding({ id: "app", termId: null, term: null }),
    ]);
    // Members audience needs staffing, which is unknowable without a term.
    expect(await listOutstandingBindings("u1")).toEqual([]);
    expect(h.isStaffedInTerm).not.toHaveBeenCalled();
  });

  describe("mentee countersignatures", () => {
    const menteeDoc = (over: Record<string, unknown> = {}) =>
      binding({
        id: "m1",
        document: { ...binding().document, audience: "Mentors", requiresMenteeCountersign: true },
        ...over,
      });

    function pairs(mentors: string[], termId = "t-now") {
      h.prisma.mentorshipPair.findMany.mockResolvedValue(mentors.map((m) => ({ mentorUserId: m, termId })));
    }

    it("is owed once one of the user's mentors signed the in-force version", async () => {
      h.prisma.signingBinding.findMany.mockResolvedValue([menteeDoc()]);
      pairs(["mentorA", "mentorB"]);
      h.prisma.signingSignature.findMany.mockResolvedValue([
        { bindingId: "m1", signerUserId: "mentorB", versionId: "v1" },
      ]);
      expect(await listOutstandingBindings("u1")).toEqual([
        { bindingId: "m1", documentId: "d1", documentName: "Member Agreement", versionId: "v1", role: "mentee" },
      ]);
      expect(h.prisma.signingSignature.findMany.mock.calls[0][0].where).toEqual({
        bindingId: { in: ["m1"] },
        roleKey: "member",
        signerUserId: { in: ["mentorA", "mentorB"] },
      });
    });

    it("is not owed while the mentor has not signed, or only signed an older version", async () => {
      h.prisma.signingBinding.findMany.mockResolvedValue([menteeDoc()]);
      pairs(["mentorA"]);
      expect(await listOutstandingBindings("u1")).toEqual([]);
      h.prisma.signingSignature.findMany.mockResolvedValue([
        { bindingId: "m1", signerUserId: "mentorA", versionId: "v0" },
      ]);
      expect(await listOutstandingBindings("u1")).toEqual([]);
    });

    it("is not owed when the mentor signed a different binding than this one", async () => {
      h.prisma.signingBinding.findMany.mockResolvedValue([menteeDoc()]);
      pairs(["mentorA"]);
      h.prisma.signingSignature.findMany.mockResolvedValue([
        { bindingId: "other", signerUserId: "mentorA", versionId: "v1" },
      ]);
      expect(await listOutstandingBindings("u1")).toEqual([]);
    });

    it("is not owed once the mentee already countersigned the in-force version", async () => {
      h.prisma.signingBinding.findMany.mockResolvedValue([
        menteeDoc({ signatures: [{ versionId: "v1", roleKey: "mentee" }] }),
      ]);
      pairs(["mentorA"]);
      h.prisma.signingSignature.findMany.mockResolvedValue([
        { bindingId: "m1", signerUserId: "mentorA", versionId: "v1" },
      ]);
      expect(await listOutstandingBindings("u1")).toEqual([]);
      expect(h.prisma.mentorshipPair.findMany).not.toHaveBeenCalled();
    });

    it("only counts mentors paired in the binding's own term", async () => {
      h.prisma.signingBinding.findMany.mockResolvedValue([menteeDoc()]);
      pairs(["mentorA"], "t-other");
      h.prisma.signingSignature.findMany.mockResolvedValue([
        { bindingId: "m1", signerUserId: "mentorA", versionId: "v1" },
      ]);
      expect(await listOutstandingBindings("u1")).toEqual([]);
    });

    it("is skipped for docs that do not opt in, app-scoped bindings and past terms", async () => {
      h.prisma.signingBinding.findMany.mockResolvedValue([
        menteeDoc({ id: "optout", document: { ...menteeDoc().document, requiresMenteeCountersign: false } }),
        menteeDoc({ id: "appscoped", termId: null, term: null }),
        menteeDoc({ id: "past", termId: "t-old", term: { id: "t-old", sortKey: 9 } }),
      ]);
      await listOutstandingBindings("u1");
      expect(h.prisma.mentorshipPair.findMany).not.toHaveBeenCalled();
    });

    it("includeMentee: false (MCP) never lists a countersignature", async () => {
      h.prisma.signingBinding.findMany.mockResolvedValue([menteeDoc()]);
      pairs(["mentorA"]);
      h.prisma.signingSignature.findMany.mockResolvedValue([
        { bindingId: "m1", signerUserId: "mentorA", versionId: "v1" },
      ]);
      expect(await listOutstandingBindings("u1", { includeMentee: false })).toEqual([]);
    });
  });
});

describe("countOutstandingBindings / getAppGateOutstanding", () => {
  it("count equals the number of obligations and the gate returns the first one", async () => {
    h.prisma.signingBinding.findMany.mockResolvedValue([binding({ id: "a" }), binding({ id: "b" })]);
    expect(await countOutstandingBindings("u1")).toBe(2);
    expect((await getAppGateOutstanding("u1"))?.bindingId).toBe("a");
  });

  it("the gate is null when nothing is owed", async () => {
    expect(await getAppGateOutstanding("u1")).toBeNull();
  });

  it("the gate includes mentee countersignatures", async () => {
    h.prisma.signingBinding.findMany.mockResolvedValue([
      binding({
        id: "m1",
        document: { ...binding().document, audience: "Mentors", requiresMenteeCountersign: true },
      }),
    ]);
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ mentorUserId: "mA", termId: "t-now" }]);
    h.prisma.signingSignature.findMany.mockResolvedValue([
      { bindingId: "m1", signerUserId: "mA", versionId: "v1" },
    ]);
    expect((await getAppGateOutstanding("u1"))?.role).toBe("mentee");
  });
});

describe("listMySignedDocuments", () => {
  it("reads only the user's member/mentee signatures on non-hiring, non-archived documents, newest first", async () => {
    h.prisma.signingSignature.findMany.mockResolvedValue([]);
    h.prisma.signingSignature.findMany.mockClear();
    await listMySignedDocuments("u1");
    const arg = h.prisma.signingSignature.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      signerUserId: "u1",
      roleKey: { in: ["member", "mentee"] },
      binding: { document: { gateScope: { not: "HiringCycle" }, archivedAt: null } },
    });
    expect(arg.orderBy).toEqual({ signedAt: "desc" });
  });

  it("labels the context by cycle name, then term code, then Lab-wide", async () => {
    const at = new Date("2026-01-01");
    const row = (id: string, term: { code: string } | null, cycle: { name: string } | null) => ({
      id,
      signedAt: at,
      bindingId: `b-${id}`,
      binding: { document: { name: `Doc ${id}` }, term, cycle },
    });
    h.prisma.signingSignature.findMany.mockResolvedValue([
      row("c", { code: "26F" }, { name: "Fall Cycle" }),
      row("t", { code: "26F" }, null),
      row("l", null, null),
    ]);
    expect(await listMySignedDocuments("u1")).toEqual([
      { signatureId: "c", bindingId: "b-c", documentName: "Doc c", context: "Fall Cycle", signedAt: at },
      { signatureId: "t", bindingId: "b-t", documentName: "Doc t", context: "Term 26F", signedAt: at },
      { signatureId: "l", bindingId: "b-l", documentName: "Doc l", context: "Lab-wide", signedAt: at },
    ]);
  });
});

describe("getBindingStateForUser", () => {
  it("is not_found for a missing binding", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(null);
    expect(await getBindingStateForUser("u1", "x")).toEqual({ status: "not_found" });
  });

  it("is signed only for a signature at the in-force version", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue({ versionId: "v2", signatures: [{ versionId: "v2" }] });
    expect(await getBindingStateForUser("u1", "b")).toEqual({ status: "signed" });
    h.prisma.signingBinding.findUnique.mockResolvedValue({ versionId: "v2", signatures: [{ versionId: "v1" }] });
    expect(await getBindingStateForUser("u1", "b")).toEqual({ status: "unsigned" });
  });

  it("reads the member slot by default and the requested slot otherwise", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue({ versionId: "v", signatures: [] });
    await getBindingStateForUser("u1", "b");
    expect(h.prisma.signingBinding.findUnique.mock.calls[0][0].select.signatures.where).toEqual({
      signerUserId: "u1",
      roleKey: "member",
    });
    await getBindingStateForUser("u1", "b", "mentee");
    expect(h.prisma.signingBinding.findUnique.mock.calls[1][0].select.signatures.where.roleKey).toBe("mentee");
  });
});

describe("getSignedCopyBody (counterpart selection)", () => {
  const baseBody = [{ type: "paragraph", content: [] }];
  beforeEach(() => {
    h.prisma.signingBinding.findUnique.mockResolvedValue({
      versionId: "v1",
      termId: "t1",
      version: { body: baseBody },
    });
    h.prisma.signingSignature.findUnique.mockResolvedValue(null);
    h.prisma.signingSignature.findFirst.mockResolvedValue(null);
  });

  it("falls back to the version body when the user has no frozen snapshot", async () => {
    expect(await getSignedCopyBody("b", "u1", "member")).toBe(baseBody);
  });

  it("uses the user's frozen snapshot when present", async () => {
    const frozen = [{ type: "paragraph", content: [{ type: "text", text: "frozen" }] }];
    h.prisma.signingSignature.findUnique.mockResolvedValue({ frozenBody: frozen });
    expect(await getSignedCopyBody("b", "u1", "member")).toBe(frozen);
  });

  it("skips pairing for app-scoped bindings and for non member/mentee roles", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue({ versionId: "v1", termId: null, version: { body: baseBody } });
    expect(await getSignedCopyBody("b", "u1", "member")).toBe(baseBody);
    h.prisma.signingBinding.findUnique.mockResolvedValue({ versionId: "v1", termId: "t1", version: { body: baseBody } });
    expect(await getSignedCopyBody("b", "u1", "supervisor")).toBe(baseBody);
    expect(h.prisma.mentorshipPair.findMany).not.toHaveBeenCalled();
  });

  it("a mentor looks up their mentees' mentee signatures, in-force version only", async () => {
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ menteeUserId: "bob" }, { menteeUserId: "cy" }]);
    await getSignedCopyBody("b", "mentor", "member");
    expect(h.prisma.mentorshipPair.findMany.mock.calls[0][0].where).toEqual({ mentorUserId: "mentor", termId: "t1" });
    expect(h.prisma.signingSignature.findFirst.mock.calls[0][0]).toMatchObject({
      where: { bindingId: "b", roleKey: "mentee", versionId: "v1", signerUserId: { in: ["bob", "cy"] } },
      orderBy: { signedAt: "asc" },
    });
  });

  it("a mentee looks up their mentors' member signatures", async () => {
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ mentorUserId: "mentorA" }]);
    await getSignedCopyBody("b", "bob", "mentee");
    expect(h.prisma.mentorshipPair.findMany.mock.calls[0][0].where).toEqual({ menteeUserId: "bob", termId: "t1" });
    expect(h.prisma.signingSignature.findFirst.mock.calls[0][0].where).toMatchObject({
      roleKey: "member",
      signerUserId: { in: ["mentorA"] },
    });
  });

  it("a requested counterpart narrows the lookup to just them", async () => {
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ menteeUserId: "bob" }, { menteeUserId: "cy" }]);
    await getSignedCopyBody("b", "mentor", "member", "cy");
    expect(h.prisma.signingSignature.findFirst.mock.calls[0][0].where.signerUserId).toEqual({ in: ["cy"] });
  });

  it("returns the base body, with no signature query, when the requested counterpart is not paired", async () => {
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ menteeUserId: "bob" }]);
    expect(await getSignedCopyBody("b", "mentor", "member", "stranger")).toBe(baseBody);
    expect(h.prisma.signingSignature.findFirst).not.toHaveBeenCalled();
  });

  it("returns the base body when the counterpart's fieldValues are missing or not an object", async () => {
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ menteeUserId: "bob" }]);
    h.prisma.signingSignature.findFirst.mockResolvedValue({ fieldValues: null });
    expect(await getSignedCopyBody("b", "mentor", "member")).toBe(baseBody);
    h.prisma.signingSignature.findFirst.mockResolvedValue({ fieldValues: "oops" });
    expect(await getSignedCopyBody("b", "mentor", "member")).toBe(baseBody);
  });
});

describe("menteeCountersignState (gating predicates)", () => {
  function mb(over: Record<string, unknown> = {}) {
    return {
      versionId: "v1",
      termId: "t-now",
      document: { requiresMenteeCountersign: true, gateScope: "App" },
      term: { sortKey: 10 },
      signatures: [] as { versionId: string }[],
      ...over,
    };
  }
  beforeEach(() => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(mb());
    h.prisma.mentorshipPair.findMany.mockResolvedValue([{ mentorUserId: "m1" }]);
    h.prisma.signingSignature.findFirst.mockResolvedValue({ id: "s" });
  });

  it("a countersignature on an older version does not count as signed", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(mb({ signatures: [{ versionId: "v0" }] }));
    expect(await menteeCountersignState("u1", "b")).toBe("owed");
  });

  it("is not owed for non-App gate scopes, app-scoped bindings, or when there is no current term", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(
      mb({ document: { requiresMenteeCountersign: true, gateScope: "HiringCycle" } }),
    );
    expect(await menteeCountersignState("u1", "b")).toBe("not_owed");
    h.prisma.signingBinding.findUnique.mockResolvedValue(mb({ termId: null, term: null }));
    expect(await menteeCountersignState("u1", "b")).toBe("not_owed");
    h.prisma.signingBinding.findUnique.mockResolvedValue(mb());
    h.currentTerm.mockResolvedValue(null);
    expect(await menteeCountersignState("u1", "b")).toBe("not_owed");
  });

  it("an upcoming term's binding can be owed", async () => {
    h.prisma.signingBinding.findUnique.mockResolvedValue(mb({ termId: "t-next", term: { sortKey: 11 } }));
    expect(await menteeCountersignState("u1", "b")).toBe("owed");
  });

  it("only a mentor's member signature on the in-force version makes it owed", async () => {
    await menteeCountersignState("u1", "b");
    expect(h.prisma.signingSignature.findFirst.mock.calls[0][0].where).toEqual({
      bindingId: "b",
      roleKey: "member",
      versionId: "v1",
      signerUserId: { in: ["m1"] },
    });
  });
});
