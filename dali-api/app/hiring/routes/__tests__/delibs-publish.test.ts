import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  requireMemberSession: vi.fn(),
  requireCoreOrDomainLead: vi.fn(),
  forbidden: vi.fn(() => new Response("Forbidden", { status: 403 })),
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/hiring/lib/confidentiality", () => ({
  requireApiSignedOrForbidden: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/hiring/lib/cycle-timeline", () => ({
  parseTimeline: (t: unknown) => t,
  findRound: vi.fn(),
}));
vi.mock("~/hiring/lib/cycle-timeline.server", () => ({
  loadCycleTimeline: vi.fn().mockResolvedValue({}),
}));
vi.mock("~/hiring/lib/delibs-events.server", () => ({ publishDelibsChange: vi.fn() }));

import { prisma } from "~/lib/db";
import { requireAuth, requireCoreOrDomainLead, requireMemberSession } from "~/lib/auth";
import { hasCycleAccess, isCycleAdmin, isDomainLeadForCycle } from "~/lib/roles";
import { findRound } from "~/hiring/lib/cycle-timeline";
import { publishDelibsChange } from "~/hiring/lib/delibs-events.server";
import { action as submit } from "~/hiring/routes/api.reviews.$id.submit";
import { action as unsubmit } from "~/hiring/routes/api.reviews.$id.unsubmit";
import { action as move } from "~/hiring/routes/api.delibs.$id.moves";
import { action as openSession } from "~/hiring/routes/api.cycles.$cycleId.delibs";
import { action as closeSession } from "~/hiring/routes/api.delibs.$id";

const db = prisma as any;
const USER = "user-ada";
const CYCLE = "cycle-1";
const SESSION = "session-1";
const auth = { ok: true, auth: { user: { sub: USER } }, user: { sub: USER } } as any;

const post = (body: unknown = {}) =>
  new Request("http://test/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(auth);
  vi.mocked(requireMemberSession).mockResolvedValue(auth);
  vi.mocked(requireCoreOrDomainLead).mockResolvedValue(auth);
  vi.mocked(hasCycleAccess).mockResolvedValue(true);
  vi.mocked(isDomainLeadForCycle).mockResolvedValue(false);
  vi.mocked(isCycleAdmin).mockResolvedValue(false);
  vi.mocked(findRound).mockReturnValue({
    columns: ["Interview", "Reject"],
    isFinal: false,
    interviewRoundId: "ir-1",
  } as any);
  db.applicationReview = { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({ id: "r1" }) };
  db.dALIMember = { findUnique: vi.fn().mockResolvedValue({ id: "m1", userId: USER }) };
  db.decision = { create: vi.fn() };
  db.delibsSession = {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({ id: SESSION, columnOrder: {} }),
    upsert: vi.fn().mockResolvedValue({ id: SESSION }),
  };
  db.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(db));
});

const review = (submittedAt: Date | null) => ({
  id: "r1",
  submittedAt,
  cycleReviewer: { userId: USER, applicationCycleId: CYCLE },
});

describe("review submit / unsubmit", () => {
  it("submitting a review publishes for its cycle", async () => {
    db.applicationReview.findUnique.mockResolvedValue(review(null));
    const res = await submit({ request: post(), params: { id: "r1" } } as any);
    expect(res.status).toBe(200);
    expect(publishDelibsChange).toHaveBeenCalledExactlyOnceWith(CYCLE);
  });

  it("an already-submitted review publishes nothing", async () => {
    db.applicationReview.findUnique.mockResolvedValue(review(new Date()));
    const res = await submit({ request: post(), params: { id: "r1" } } as any);
    expect(res.status).toBe(409);
    expect(publishDelibsChange).not.toHaveBeenCalled();
  });

  it("pulling a review back publishes for its cycle", async () => {
    db.applicationReview.findUnique.mockResolvedValue(review(new Date()));
    const res = await unsubmit({ request: post(), params: { id: "r1" } } as any);
    expect(res.status).toBe(200);
    expect(publishDelibsChange).toHaveBeenCalledExactlyOnceWith(CYCLE);
  });

  it("a forbidden unsubmit publishes nothing", async () => {
    db.applicationReview.findUnique.mockResolvedValue({
      ...review(new Date()),
      cycleReviewer: { userId: "someone-else", applicationCycleId: CYCLE },
    });
    const res = await unsubmit({ request: post(), params: { id: "r1" } } as any);
    expect(res.status).toBe(403);
    expect(publishDelibsChange).not.toHaveBeenCalled();
  });
});

describe("delibs board writes", () => {
  it("moving a card publishes for the session's cycle", async () => {
    db.delibsSession.findUnique
      .mockResolvedValueOnce({ applicationCycleId: CYCLE })
      .mockResolvedValueOnce({ status: "Active", columnOrder: {}, applicationCycle: { timeline: {} } });
    const res = await move({
      request: post({ cardId: "da-1", toColumn: "Interview" }),
      params: { id: SESSION },
    } as any);
    expect(res.status).toBe(200);
    expect(publishDelibsChange).toHaveBeenCalledExactlyOnceWith(CYCLE);
  });

  it("a move on a closed session publishes nothing", async () => {
    db.delibsSession.findUnique
      .mockResolvedValueOnce({ applicationCycleId: CYCLE })
      .mockResolvedValueOnce({ status: "Closed", columnOrder: {}, applicationCycle: { timeline: {} } });
    const res = await move({
      request: post({ cardId: "da-1", toColumn: "Interview" }),
      params: { id: SESSION },
    } as any);
    expect(res.status).toBe(409);
    expect(publishDelibsChange).not.toHaveBeenCalled();
  });

  it("opening a session publishes for the cycle", async () => {
    const res = await openSession({
      request: post({ domainId: "dom-1", roundId: "round-1" }),
      params: { cycleId: CYCLE },
    } as any);
    expect(res.status).toBe(201);
    expect(publishDelibsChange).toHaveBeenCalledExactlyOnceWith(CYCLE);
  });

  it("closing a session publishes for its cycle", async () => {
    db.delibsSession.findUnique
      .mockResolvedValueOnce({ applicationCycleId: CYCLE })
      .mockResolvedValueOnce({
        id: SESSION,
        applicationCycleId: CYCLE,
        domainId: "dom-1",
        roundId: "round-1",
        columnOrder: { Interview: ["da-1"] },
        applicationCycle: { timeline: {} },
      });
    const res = await closeSession({ request: post({ intent: "close" }), params: { id: SESSION } } as any);
    expect(res.status).toBe(200);
    expect(publishDelibsChange).toHaveBeenCalledExactlyOnceWith(CYCLE);
  });
});
