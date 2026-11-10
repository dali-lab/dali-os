import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn(async () => undefined) }));
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(async () => ({ id: "om-1", deduped: false })),
  drainNow: vi.fn(async () => undefined),
}));
vi.mock("~/members/lib/membership.server", () => ({ promoteToMember: vi.fn(async () => ({ created: true })) }));
vi.mock("~/members/lib/provisioning.server", () => ({
  provisionNewMember: vi.fn(async () => ({ daliEmail: "ada@dali.example.edu", daliTempPassword: "x" })),
}));
vi.mock("~/members/lib/welcome.server", () => ({
  sendWelcome: vi.fn(async () => ({ notified: true })),
  onboardingEmailHtml: vi.fn(async () => "<onboarding/>"),
}));
vi.mock("~/hiring/lib/hiring-emails.server", () => ({ getHiringEmail: vi.fn() }));
vi.mock("~/email/lib/templates.server", () => ({ getEmailTemplate: vi.fn(async () => null) }));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { promoteToMember } from "~/members/lib/membership.server";
import { getHiringEmail } from "~/hiring/lib/hiring-emails.server";
import {
  listActiveWaitlistEntries,
  acceptFromWaitlist,
  removeFromWaitlist,
  reorderWaitlist,
} from "~/hiring/lib/waitlist.server";

const db = prisma as any;
const request = new Request("http://localhost/api/waitlist", { method: "POST" });

const decision = (id: string, type: string, rank: number | null = null, at = "2026-05-01T00:00:00Z") => ({
  id,
  type,
  waitlistRank: rank,
  createdAt: new Date(at),
});

const candidate = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  domain: { id: "dom1", name: "design", displayName: "Design" },
  decisions: [decision(`dec-${id}`, "Waitlisted", 1)],
  application: {
    applicationCycleId: "c1",
    user: { id: `user-${id}`, firstName: "Ada", lastName: "Lovelace", dartmouthEmail: "ada@example.edu" },
    applicationCycle: {
      id: "c1",
      name: "26F",
      applicants: "Students",
      statusUpdates: [{ newStatus: "Completed" }],
    },
  },
  ...over,
});

let tx: any;

beforeEach(() => {
  vi.clearAllMocks();
  tx = {
    applicationCycleStatusUpdate: { create: vi.fn() },
    decision: { create: vi.fn(async () => ({ id: "dec-released" })), update: vi.fn() },
    domainApplication: { findMany: vi.fn().mockResolvedValue([]) },
  };
  db.$transaction = vi.fn(async (fn: (t: any) => unknown) => fn(tx));
  db.domainApplication = { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() };
  db.applicationCycleStatusUpdate = { findFirst: vi.fn().mockResolvedValue({ newStatus: "UnderReview" }) };
});

describe("listActiveWaitlistEntries", () => {
  it("lists a domain application only while its latest Released decision is still Waitlisted", async () => {
    db.domainApplication.findMany.mockResolvedValue([
      candidate("still"),
      candidate("accepted", { decisions: [decision("d2", "Accepted")] }),
      candidate("none", { decisions: [] }),
    ]);

    const entries = await listActiveWaitlistEntries();

    expect(entries.map((e) => e.domainApplicationId)).toEqual(["still"]);
    expect(entries[0]).toMatchObject({
      decisionId: "dec-still",
      rank: 1,
      applicant: { userId: "user-still", firstName: "Ada", dartmouthEmail: "ada@example.edu" },
      cycle: { id: "c1", name: "26F", applicants: "Students", status: "Completed" },
    });
  });

  it("sorts by domain display name, then rank, and puts unranked entries last", async () => {
    const inDomain = (id: string, displayName: string, rank: number | null) =>
      candidate(id, {
        domain: { id: displayName, name: displayName.toLowerCase(), displayName },
        decisions: [decision(`dec-${id}`, "Waitlisted", rank)],
      });
    db.domainApplication.findMany.mockResolvedValue([
      inDomain("dev-unranked", "Dev", null),
      inDomain("dev-2", "Dev", 2),
      inDomain("design-1", "Design", 1),
      inDomain("dev-1", "Dev", 1),
    ]);

    const entries = await listActiveWaitlistEntries();

    expect(entries.map((e) => e.domainApplicationId)).toEqual(["design-1", "dev-1", "dev-2", "dev-unranked"]);
    expect(entries[3].rank).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("defaults the cycle status to Draft when it has no status updates", async () => {
    const c = candidate("x");
    c.application.applicationCycle.statusUpdates = [];
    db.domainApplication.findMany.mockResolvedValue([c]);

    expect((await listActiveWaitlistEntries())[0].cycle.status).toBe("Draft");
  });

  it("narrows by cycle and by domain when asked", async () => {
    await listActiveWaitlistEntries({ cycleId: "c9", domainId: "d9" });

    expect(db.domainApplication.findMany.mock.calls[0][0].where).toEqual({
      decisions: { some: { stage: "Released", type: "Waitlisted" } },
      application: { applicationCycleId: "c9" },
      domainId: "d9",
    });
  });
});

describe("acceptFromWaitlist, guard paths and side effects", () => {
  const accept = () => acceptFromWaitlist({ domainApplicationId: "da1", actorId: "lead", request });
  const waitlistedDa = (over: Record<string, unknown> = {}) => ({
    id: "da1",
    domain: { id: "dom1", name: "design", displayName: "Design" },
    application: {
      applicationCycleId: "c1",
      userId: "applicant",
      user: { firstName: "Ada", dartmouthEmail: "ada@example.edu", netId: null },
      startTerm: null,
      applicationCycle: { offerRespondBy: null, waitlistRespondBy: null, term: null },
    },
    decisions: [decision("dec-wl", "Waitlisted", 2)],
    ...over,
  });

  beforeEach(() => {
    db.domainApplication.findUnique.mockResolvedValue(waitlistedDa());
    vi.mocked(getHiringEmail).mockResolvedValue({ subject: "Welcome", body: "Hi" } as any);
  });

  it("reports not-found", async () => {
    db.domainApplication.findUnique.mockResolvedValue(null);

    expect(await accept()).toMatchObject({ ok: false, reason: "not-found" });
  });

  it("reports no-domain", async () => {
    db.domainApplication.findUnique.mockResolvedValue(waitlistedDa({ domain: null }));

    expect(await accept()).toMatchObject({ ok: false, reason: "no-domain" });
  });

  it.each([
    ["no released decision", []],
    ["a latest decision that is no longer Waitlisted", [decision("d", "Accepted")]],
  ])("refuses someone with %s and writes nothing", async (_l, decisions) => {
    db.domainApplication.findUnique.mockResolvedValue(waitlistedDa({ decisions }));

    expect(await accept()).toMatchObject({ ok: false, reason: "not-waitlisted" });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(promoteToMember).not.toHaveBeenCalled();
  });

  it("refuses before any write when no Accepted email is written", async () => {
    vi.mocked(getHiringEmail).mockResolvedValue(null as any);

    expect(await accept()).toMatchObject({ ok: false, reason: "no-email-binding" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("appends an Accepted Released decision that points at the waitlisted one, as the actor", async () => {
    const res = await accept();

    expect(res).toEqual({ ok: true, releasedDecisionId: "dec-released", cycleReopened: false });
    expect(tx.decision.create).toHaveBeenCalledWith({
      data: {
        domainApplicationId: "da1",
        type: "Accepted",
        stage: "Released",
        madeById: "lead",
        notes: "Accepted off the waitlist.",
        parentDecisionId: "dec-wl",
      },
    });
    expect(tx.applicationCycleStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("promotes the applicant at P1 in the domain and emails them once, keyed by domain application", async () => {
    await accept();

    expect(promoteToMember).toHaveBeenCalledWith({ userId: "applicant", domainId: "dom1", level: "P1", actorId: "lead" });
    expect(vi.mocked(enqueueOutbound).mock.calls[0][0]).toMatchObject({
      dedupKey: "hiring.waitlist.accept:da1",
      target: "ada@example.edu",
      recipientUserId: "applicant",
      eventType: "hiring.waitlist.accept",
    });
    expect(drainNow).toHaveBeenCalledWith(["om-1"]);
  });

  it("reopens a Completed cycle for the write and completes it again afterwards", async () => {
    db.applicationCycleStatusUpdate.findFirst.mockResolvedValue({ newStatus: "Completed" });

    const res = await accept();

    expect(res).toMatchObject({ ok: true, cycleReopened: true });
    expect(tx.applicationCycleStatusUpdate.create.mock.calls.map(([a]: any) => a.data.newStatus)).toEqual([
      "UnderReview",
      "Completed",
    ]);
    expect(tx.applicationCycleStatusUpdate.create.mock.calls[0][0].data).toMatchObject({ applicationCycleId: "c1", userId: "lead" });
  });

  it("still returns ok and keeps the decision when promotion fails", async () => {
    vi.mocked(promoteToMember).mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await accept()).toMatchObject({ ok: true });
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({ memberPromoted: false });
  });

  it("closes the rank gap the accepted applicant leaves, across the domain", async () => {
    tx.domainApplication.findMany.mockResolvedValue([
      { decisions: [decision("dec-a", "Waitlisted", 1)] },
      { decisions: [decision("dec-b", "Waitlisted", 3)] },
      { decisions: [decision("dec-c", "Accepted", null)] },
      { decisions: [decision("dec-d", "Waitlisted", null)] },
    ]);

    await accept();

    expect(tx.domainApplication.findMany.mock.calls[0][0].where).toMatchObject({ domainId: "dom1" });
    expect(tx.decision.update.mock.calls.map(([a]: any) => a)).toEqual([{ where: { id: "dec-b" }, data: { waitlistRank: 2 } }]);
  });

  it("audits the accept without the one-time password", async () => {
    await accept();

    const audit = vi.mocked(logAuditEvent).mock.calls[0][0] as any;
    expect(audit).toMatchObject({
      action: "waitlist.accept",
      userId: "lead",
      targetId: "dec-released",
      metadata: { acceptedFromRank: 2, cycleReopened: false, emailSent: true, memberPromoted: true },
    });
    expect(JSON.stringify(audit)).not.toContain("daliTempPassword");
  });
});

describe("removeFromWaitlist", () => {
  const remove = () => removeFromWaitlist({ domainApplicationId: "da1", actorId: "lead", request });
  const da = (over: Record<string, unknown> = {}, applicants = "Students", user: Record<string, unknown> = {}) => ({
    id: "da1",
    domain: { id: "dom1", name: "design", displayName: "Design" },
    application: {
      applicationCycleId: "c1",
      userId: "applicant",
      applicationCycle: { applicants },
      user: { firstName: "Ada", dartmouthEmail: "ada@example.edu", netId: null, ...user },
    },
    decisions: [decision("dec-wl", "Waitlisted", 2)],
    ...over,
  });

  beforeEach(() => {
    db.domainApplication.findUnique.mockResolvedValue(da());
    vi.mocked(getHiringEmail).mockResolvedValue({ subject: "Still interested, {{firstName}}?", body: "Reapply to {{domain}}." } as any);
  });

  it("reports not-found, no-domain and not-waitlisted without writing", async () => {
    db.domainApplication.findUnique.mockResolvedValueOnce(null);
    expect(await remove()).toMatchObject({ ok: false, reason: "not-found" });

    db.domainApplication.findUnique.mockResolvedValueOnce(da({ domain: null }));
    expect(await remove()).toMatchObject({ ok: false, reason: "no-domain" });

    db.domainApplication.findUnique.mockResolvedValueOnce(da({ decisions: [decision("d", "Rejected")] }));
    expect(await remove()).toMatchObject({ ok: false, reason: "not-waitlisted" });

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("appends a Rejected Released decision as the actor, linked to the waitlisted one", async () => {
    const res = await remove();

    expect(res).toEqual({ ok: true, releasedDecisionId: "dec-released", emailSent: true });
    expect(tx.decision.create).toHaveBeenCalledWith({
      data: {
        domainApplicationId: "da1",
        type: "Rejected",
        stage: "Released",
        madeById: "lead",
        notes: "Removed from the waitlist.",
        parentDecisionId: "dec-wl",
      },
    });
  });

  it("invites a Students applicant to reapply with the continued interest email", async () => {
    await remove();

    expect(vi.mocked(enqueueOutbound).mock.calls[0][0]).toMatchObject({
      dedupKey: "hiring.waitlist.remove:dec-released",
      target: "ada@example.edu",
      recipientUserId: "applicant",
      subject: "Still interested, Ada?",
      eventType: "hiring.waitlist.remove",
    });
    expect((vi.mocked(enqueueOutbound).mock.calls[0][0] as any).bodyHtml).toContain("Reapply to Design.");
    expect(drainNow).toHaveBeenCalledWith(["om-1"]);
  });

  it.each(["Interns", "LabMembers"])("sends a %s applicant no email", async (applicants) => {
    db.domainApplication.findUnique.mockResolvedValue(da({}, applicants));

    const res = await remove();

    expect(res).toMatchObject({ ok: true, emailSent: false });
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("sends no email when the continued interest email has not been written", async () => {
    vi.mocked(getHiringEmail).mockResolvedValue(null as any);

    expect(await remove()).toMatchObject({ ok: true, emailSent: false });
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("falls back to the netId address", async () => {
    db.domainApplication.findUnique.mockResolvedValue(da({}, "Students", { dartmouthEmail: null, netId: "f00abcd" }));

    await remove();

    expect((vi.mocked(enqueueOutbound).mock.calls[0][0] as any).target).toBe("f00abcd@dartmouth.edu");
  });

  it("reports emailSent false when the outbox deduped the message", async () => {
    vi.mocked(enqueueOutbound).mockResolvedValueOnce({ id: "om-1", deduped: true } as any);

    expect(await remove()).toMatchObject({ ok: true, emailSent: false });
  });

  it("keeps them removed when the email fails", async () => {
    vi.mocked(enqueueOutbound).mockRejectedValueOnce(new Error("smtp"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await remove()).toMatchObject({ ok: true, emailSent: false });
    expect(vi.mocked(logAuditEvent).mock.calls[0][0]).toMatchObject({ action: "waitlist.remove" });
  });

  it("compacts the domain's ranks and audits the rank they left", async () => {
    tx.domainApplication.findMany.mockResolvedValue([
      { decisions: [decision("dec-a", "Waitlisted", 1)] },
      { decisions: [decision("dec-b", "Waitlisted", 3)] },
    ]);

    await remove();

    expect(tx.decision.update).toHaveBeenCalledWith({ where: { id: "dec-b" }, data: { waitlistRank: 2 } });
    expect(tx.decision.update).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toMatchObject({ removedFromRank: 2, emailSent: true });
  });
});

describe("reorderWaitlist", () => {
  const entry = (id: string, rank: number, applicants = "Students") =>
    candidate(id, {
      decisions: [decision(`dec-${id}`, "Waitlisted", rank)],
      application: {
        ...candidate(id).application,
        applicationCycle: { id: "c1", name: "26F", applicants, statusUpdates: [] },
      },
    });
  const reorder = (order: string[], visible: (e: any) => boolean = () => true) =>
    reorderWaitlist({ domainId: "dom1", order, visible, actorId: "lead", request });

  beforeEach(() => {
    db.domainApplication.findMany.mockResolvedValue([entry("a", 1), entry("b", 2), entry("c", 3)]);
  });

  it("renumbers 1..N in the given order and skips entries whose rank already matches", async () => {
    const res = await reorder(["c", "b", "a"]);

    expect(res).toEqual({ ok: true });
    expect(tx.decision.update.mock.calls.map(([a]: any) => a)).toEqual([
      { where: { id: "dec-c" }, data: { waitlistRank: 1 } },
      { where: { id: "dec-a" }, data: { waitlistRank: 3 } },
    ]);
  });

  it("audits the before and after order", async () => {
    await reorder(["b", "a", "c"]);

    expect(vi.mocked(logAuditEvent).mock.calls[0][0]).toMatchObject({
      action: "waitlist.reorder",
      userId: "lead",
      targetId: "dom1",
      metadata: {
        domainId: "dom1",
        before: [
          { domainApplicationId: "a", rank: 1 },
          { domainApplicationId: "b", rank: 2 },
          { domainApplicationId: "c", rank: 3 },
        ],
        order: ["b", "a", "c"],
      },
    });
  });

  it.each([
    ["a missing entry", ["a", "b"]],
    ["an unknown id", ["a", "b", "zzz"]],
    ["a duplicated id", ["a", "a", "b"]],
    ["an extra entry", ["a", "b", "c", "d"]],
  ])("rejects %s as stale without writing", async (_l, order) => {
    const res = await reorder(order);

    expect(res).toMatchObject({ ok: false, reason: "stale" });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("only considers entries the caller may see, so hidden ones keep their ranks", async () => {
    db.domainApplication.findMany.mockResolvedValue([entry("a", 1), entry("lab", 2, "LabMembers"), entry("c", 3)]);
    const visible = (e: any) => e.cycle.applicants !== "LabMembers";

    expect(await reorder(["a", "lab", "c"], visible)).toMatchObject({ ok: false, reason: "stale" });

    expect(await reorder(["c", "a"], visible)).toEqual({ ok: true });
    expect(tx.decision.update.mock.calls.map(([a]: any) => a)).toEqual([
      { where: { id: "dec-c" }, data: { waitlistRank: 1 } },
      { where: { id: "dec-a" }, data: { waitlistRank: 2 } },
    ]);
  });
});
