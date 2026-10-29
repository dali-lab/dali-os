import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db");

import { applyContinue, applyNotContinuing, applyUndecided } from "../partner-renewals.server";

function fakeDb() {
  const tx = {
    projectTermStatus: {
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
    },
    projectTerm: { upsert: vi.fn() },
    projectRoleRequest: { deleteMany: vi.fn(), createMany: vi.fn() },
    projectAssignment: { count: vi.fn().mockResolvedValue(0) },
  };
  const db = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    projectTermStatus: { upsert: vi.fn() },
  };
  return { db: db as never, tx, raw: db };
}

beforeEach(() => vi.clearAllMocks());

describe("applyContinue", () => {
  const base = { projectId: "p", decisionTermId: "t1", feeCents: 5000, userId: "u", roles: [{ domainId: "d", slots: 2 }] };

  it("writes the status, term and P1 role requests in one transaction", async () => {
    const { db, tx, raw } = fakeDb();
    await applyContinue(db, { ...base, chosenTermId: "t1" });
    expect(raw.$transaction).toHaveBeenCalledOnce();
    expect(tx.projectTermStatus.upsert).toHaveBeenCalledTimes(1);
    expect(tx.projectTermStatus.upsert.mock.calls[0][0].where).toEqual({
      projectId_termId: { projectId: "p", termId: "t1" },
    });
    expect(tx.projectTermStatus.upsert.mock.calls[0][0].create).toMatchObject({
      isContinuing: true,
      feeCents: 5000,
      setBy: "u",
    });
    expect(tx.projectTerm.upsert).toHaveBeenCalledOnce();
    expect(tx.projectRoleRequest.deleteMany).toHaveBeenCalledWith({ where: { projectId: "p", termId: "t1" } });
    expect(tx.projectRoleRequest.createMany).toHaveBeenCalledWith({
      data: [{ projectId: "p", termId: "t1", domainId: "d", level: "P1", slots: 2 }],
    });
  });

  it("also writes the skipped term as not continuing for a later term", async () => {
    const { db, tx } = fakeDb();
    await applyContinue(db, { ...base, chosenTermId: "t3" });
    const termsWritten = tx.projectTermStatus.upsert.mock.calls.map((c) => [
      c[0].where.projectId_termId.termId,
      c[0].create.isContinuing,
    ]);
    expect(termsWritten).toEqual([
      ["t1", false],
      ["t3", true],
    ]);
    expect(tx.projectTerm.upsert.mock.calls[0][0].where.projectId_termId.termId).toBe("t3");
  });

  it("skips createMany when no spots are requested", async () => {
    const { db, tx } = fakeDb();
    await applyContinue(db, { ...base, roles: [], chosenTermId: "t1" });
    expect(tx.projectRoleRequest.createMany).not.toHaveBeenCalled();
  });
});

describe("next step on decisions", () => {
  it("writes the next step on the chosen continuing row only", async () => {
    const { db, tx } = fakeDb();
    const due = new Date("2026-11-02T00:00:00.000Z");
    await applyContinue(db, {
      projectId: "p", decisionTermId: "t1", chosenTermId: "t3", feeCents: null, roles: [], userId: "u",
      nextStep: "Send SOW", nextStepDueAt: due,
    });
    const [skipped, chosen] = tx.projectTermStatus.upsert.mock.calls.map((c) => c[0].create);
    expect(skipped.nextStep).toBeUndefined();
    expect(chosen).toMatchObject({ nextStep: "Send SOW", nextStepDueAt: due });
  });

  it("writes the next step with a not-continuing decision", async () => {
    const { db, raw } = fakeDb();
    await applyNotContinuing(db, { projectId: "p", decisionTermId: "t1", reason: "x", userId: "u", nextStep: "Thank them" });
    expect(raw.projectTermStatus.upsert.mock.calls[0][0].create).toMatchObject({ nextStep: "Thank them" });
  });
});

describe("applyNotContinuing", () => {
  it("upserts a false status with the reason", async () => {
    const { db, raw } = fakeDb();
    await applyNotContinuing(db, { projectId: "p", decisionTermId: "t1", reason: "No budget", userId: "u" });
    expect(raw.projectTermStatus.upsert.mock.calls[0][0].create).toMatchObject({
      isContinuing: false,
      reason: "No budget",
    });
  });
});

describe("applyUndecided", () => {
  it("does nothing without a decision row", async () => {
    const { db, tx } = fakeDb();
    tx.projectTermStatus.findUnique.mockResolvedValue(null);
    await applyUndecided(db, { projectId: "p", decisionTermId: "t1" });
    expect(tx.projectTermStatus.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes a continuing row and its role requests when nobody is assigned", async () => {
    const { db, tx } = fakeDb();
    tx.projectTermStatus.findUnique.mockResolvedValue({ isContinuing: true, term: { sortKey: 271 } });
    await applyUndecided(db, { projectId: "p", decisionTermId: "t1" });
    expect(tx.projectTermStatus.deleteMany).toHaveBeenCalledWith({ where: { projectId: "p", termId: "t1" } });
    expect(tx.projectRoleRequest.deleteMany).toHaveBeenCalledWith({ where: { projectId: "p", termId: "t1" } });
  });

  it("keeps role requests when staffing assignments exist", async () => {
    const { db, tx } = fakeDb();
    tx.projectTermStatus.findUnique.mockResolvedValue({ isContinuing: true, term: { sortKey: 271 } });
    tx.projectAssignment.count.mockResolvedValue(2);
    await applyUndecided(db, { projectId: "p", decisionTermId: "t1" });
    expect(tx.projectRoleRequest.deleteMany).not.toHaveBeenCalled();
  });

  it("creates an undecided row when a next step is set and no row exists", async () => {
    const { db, tx } = fakeDb();
    tx.projectTermStatus.findUnique.mockResolvedValue(null);
    await applyUndecided(db, { projectId: "p", decisionTermId: "t1", userId: "u", nextStep: "Call", nextStepDueAt: null });
    expect(tx.projectTermStatus.create.mock.calls[0][0].data).toMatchObject({
      projectId: "p",
      termId: "t1",
      isContinuing: null,
      nextStep: "Call",
    });
  });

  it("keeps the row as undecided with the next step instead of deleting it", async () => {
    const { db, tx } = fakeDb();
    tx.projectTermStatus.findUnique.mockResolvedValue({ isContinuing: true, term: { sortKey: 271 } });
    await applyUndecided(db, { projectId: "p", decisionTermId: "t1", userId: "u", nextStep: "Call", nextStepDueAt: null });
    expect(tx.projectTermStatus.update.mock.calls[0][0].data).toMatchObject({
      isContinuing: null,
      reason: null,
      feeCents: null,
      nextStep: "Call",
    });
    expect(tx.projectTermStatus.deleteMany).not.toHaveBeenCalled();
    expect(tx.projectRoleRequest.deleteMany).toHaveBeenCalledWith({ where: { projectId: "p", termId: "t1" } });
  });

  it("still deletes the later continuing row of a skipped term when keeping the next step", async () => {
    const { db, tx } = fakeDb();
    tx.projectTermStatus.findUnique
      .mockResolvedValueOnce({ isContinuing: false, term: { sortKey: 271 } })
      .mockResolvedValueOnce({ isContinuing: false })
      .mockResolvedValueOnce({ isContinuing: true });
    tx.projectTermStatus.findMany.mockResolvedValue([{ termId: "t3" }]);
    await applyUndecided(db, { projectId: "p", decisionTermId: "t1", nextStep: "Call" });
    expect(tx.projectTermStatus.update).toHaveBeenCalledOnce();
    expect(tx.projectTermStatus.deleteMany.mock.calls.map((c) => c[0].where.termId)).toEqual(["t3"]);
  });

  it("also clears the later continuing row of a skipped term", async () => {
    const { db, tx } = fakeDb();
    tx.projectTermStatus.findUnique
      .mockResolvedValueOnce({ isContinuing: false, term: { sortKey: 271 } })
      .mockResolvedValueOnce({ isContinuing: false })
      .mockResolvedValueOnce({ isContinuing: true });
    tx.projectTermStatus.findMany.mockResolvedValue([{ termId: "t3" }]);
    await applyUndecided(db, { projectId: "p", decisionTermId: "t1" });
    expect(tx.projectTermStatus.deleteMany.mock.calls.map((c) => c[0].where.termId)).toEqual(["t1", "t3"]);
    expect(tx.projectRoleRequest.deleteMany).toHaveBeenCalledWith({ where: { projectId: "p", termId: "t3" } });
  });
});
