import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/admin/lib/eligibility.server", () => ({ addOrUpdateEligibility: vi.fn() }));
vi.mock("../staffing-events.server", () => ({ publishCycleChange: vi.fn() }));

import { mockedPrisma } from "~/test-utils/prisma";
import { logAuditEvent } from "~/lib/audit";
import { addOrUpdateEligibility } from "~/admin/lib/eligibility.server";
import { publishCycleChange } from "../staffing-events.server";
import { assignStaffing, setDomainEligibility, StaffingWriteError } from "../staffing-assign.server";

const db = mockedPrisma();
const base = { cycleId: "c1", userId: "u1", actorId: "lead", domains: [] as { domainId: string; level: "P1" | "P2" | "P3" }[] };

beforeEach(() => {
  vi.resetAllMocks();
  db.staffingCycle.findUnique.mockResolvedValue({ id: "c1", termId: "t1" } as never);
  db.project.findUnique.mockResolvedValue({ id: "pB" } as never);
  db.domain.count.mockResolvedValue(1);
  db.staffingAssignment.deleteMany.mockResolvedValue({ count: 2 } as never);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
});

describe("assignStaffing", () => {
  it("replaces Proposed rows on the project with one per domain", async () => {
    const out = await assignStaffing({ ...base, projectId: "pB", domains: [{ domainId: "d1", level: "P2" }] });
    expect(out).toEqual({ proposed: 1, clearedProposed: 2 });
    expect(db.staffingAssignment.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", staffingCycleId: "c1", projectId: { in: ["pB"] }, status: "Proposed" },
    });
    expect(db.staffingAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: "pB", termId: "t1", status: "Proposed", assignedById: "lead" }),
    });
    expect(db.projectAssignment.deleteMany).not.toHaveBeenCalled();
  });

  it("fully unassigns by clearing every Proposed row in the cycle", async () => {
    const out = await assignStaffing({ ...base, projectId: null });
    expect(out).toEqual({ proposed: 0, clearedProposed: 2 });
    expect(db.staffingAssignment.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", staffingCycleId: "c1", status: "Proposed" },
    });
    expect(db.staffingAssignment.create).not.toHaveBeenCalled();
  });

  it("moves A to B by declining Confirmed rows and deleting the roster row on A", async () => {
    await assignStaffing({ ...base, projectId: "pB", fromProjectId: "pA", domains: [{ domainId: "d1", level: "P2" }] });
    expect(db.staffingAssignment.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ projectId: { in: ["pB", "pA"] } }) }),
    );
    expect(db.staffingAssignment.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", staffingCycleId: "c1", projectId: "pA", status: "Confirmed" },
      data: { status: "Declined" },
    });
    expect(db.projectAssignment.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", projectId: "pA", termId: "t1" },
    });
  });

  it("audits and publishes on every path", async () => {
    await assignStaffing({ ...base, projectId: null });
    await assignStaffing({ ...base, projectId: "pB", domains: [{ domainId: "d1", level: "P2" }] });
    expect(logAuditEvent).toHaveBeenCalledTimes(2);
    expect(logAuditEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "staffing.assign",
        userId: "lead",
        targetId: "u1",
        metadata: expect.objectContaining({ cycleId: "c1", projectId: "pB", domainId: "d1", level: "P2" }),
      }),
    );
    expect(publishCycleChange).toHaveBeenCalledTimes(2);
    expect(publishCycleChange).toHaveBeenCalledWith("c1");
  });

  it.each([
    ["cycle", () => db.staffingCycle.findUnique.mockResolvedValue(null as never), 404],
    ["project", () => db.project.findUnique.mockResolvedValue(null as never), 404],
    ["domain", () => db.domain.count.mockResolvedValue(0), 400],
  ])("rejects a missing %s without writing", async (_n, arrange, status) => {
    arrange();
    await expect(
      assignStaffing({ ...base, projectId: "pB", domains: [{ domainId: "d1", level: "P2" }] }),
    ).rejects.toMatchObject({ status });
    expect(db.staffingAssignment.deleteMany).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(publishCycleChange).not.toHaveBeenCalled();
  });

  it("requires domains when assigning to a project", async () => {
    await expect(assignStaffing({ ...base, projectId: "pB" })).rejects.toBeInstanceOf(StaffingWriteError);
  });
});

describe("setDomainEligibility", () => {
  const args = { userId: "u1", domainId: "d1", level: "P3" as const, actorId: "lead" };
  beforeEach(() => {
    db.domain.findUnique.mockResolvedValue({ id: "d1", name: "dev", displayName: "Development" } as never);
    db.user.findUnique.mockResolvedValue({ id: "u1" } as never);
    db.domainEligibility.findFirst.mockResolvedValue(null);
  });

  it("upserts through the shared writer so promotedBy is stamped, and reports created", async () => {
    const out = await setDomainEligibility(args);
    expect(addOrUpdateEligibility).toHaveBeenCalledWith({ userId: "u1", domainId: "d1", level: "P3", actorId: "lead" });
    expect(out).toEqual({ created: true, domainName: "Development" });
  });

  it("reports an existing row as not created", async () => {
    db.domainEligibility.findFirst.mockResolvedValue({ id: "de1" } as never);
    expect((await setDomainEligibility(args)).created).toBe(false);
  });

  it("without a cycle audits but skips the live sync and publish", async () => {
    await setDomainEligibility(args);
    expect(db.staffingAssignment.findMany).not.toHaveBeenCalled();
    expect(publishCycleChange).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "staffing.eligibility.set", userId: "lead", targetId: "u1" }),
    );
  });

  it("with a cycle rewrites only affected projects and publishes", async () => {
    db.staffingAssignment.findMany.mockResolvedValue([
      { id: "a1", userId: "u1", projectId: "pA", domainId: "d1", level: "P1", status: "Proposed" },
      { id: "a2", userId: "u1", projectId: "pA", domainId: "d2", level: "P2", status: "Proposed" },
      { id: "a3", userId: "u1", projectId: "pB", domainId: "d2", level: "P2", status: "Proposed" },
    ] as never);
    db.staffingAssignment.deleteMany.mockResolvedValue({ count: 0 } as never);
    await setDomainEligibility({ ...args, cycleId: "c1" });
    expect(db.staffingAssignment.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.staffingAssignment.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", staffingCycleId: "c1", projectId: "pA", status: "Proposed" },
    });
    const levels = db.staffingAssignment.create.mock.calls.map((c) => [c[0].data.domainId, c[0].data.level]);
    expect(levels).toEqual([["d1", "P3"], ["d2", "P2"]]);
    expect(publishCycleChange).toHaveBeenCalledWith("c1");
  });

  it.each([
    ["domain", () => db.domain.findUnique.mockResolvedValue(null as never)],
    ["user", () => db.user.findUnique.mockResolvedValue(null as never)],
  ])("404s on a missing %s without writing", async (_n, arrange) => {
    arrange();
    await expect(setDomainEligibility(args)).rejects.toMatchObject({ status: 404 });
    expect(addOrUpdateEligibility).not.toHaveBeenCalled();
  });

  it("404s on a missing cycle", async () => {
    db.staffingCycle.findUnique.mockResolvedValue(null as never);
    await expect(setDomainEligibility({ ...args, cycleId: "gone" })).rejects.toMatchObject({ status: 404 });
  });
});
