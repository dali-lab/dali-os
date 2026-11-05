import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");

import { setTermSpots } from "../planning-spots.server";

function fakeDb() {
  const tx = {
    projectTerm: { findUnique: vi.fn().mockResolvedValue({ projectId: "p1" }) },
    projectRoleRequest: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
      update: vi.fn(),
      createMany: vi.fn(),
    },
  };
  const db = {
    domain: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => ["eng", "des"].includes(id)).map((id) => ({ id })),
      ),
    },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  return { db: db as never, tx, raw: db };
}

const input = { projectId: "p1", termId: "t1" };

beforeEach(() => vi.clearAllMocks());

describe("setTermSpots", () => {
  it("only accepts active, non-system domains", async () => {
    const { db, raw, tx } = fakeDb();
    const result = await setTermSpots(db, {
      ...input,
      roles: [
        { domainId: "eng", slots: 1 },
        { domainId: "sys", slots: 1 },
      ],
    });
    expect(result).toBe("unknown-domain");
    expect(raw.domain.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["eng", "sys"] },
      active: true,
      isSystem: false,
    });
    expect(raw.$transaction).not.toHaveBeenCalled();
    expect(tx.projectRoleRequest.createMany).not.toHaveBeenCalled();
  });

  it("refuses a term the project is not on", async () => {
    const { db, tx } = fakeDb();
    tx.projectTerm.findUnique.mockResolvedValue(null);
    expect(await setTermSpots(db, { ...input, roles: [{ domainId: "eng", slots: 2 }] })).toBe("not-in-term");
    expect(tx.projectTerm.findUnique.mock.calls[0][0].where).toEqual({
      projectId_termId: { projectId: "p1", termId: "t1" },
    });
    expect(tx.projectRoleRequest.findMany).not.toHaveBeenCalled();
  });

  it("applies deletes, updates and P1 creates for the term in one transaction", async () => {
    const { db, tx, raw } = fakeDb();
    tx.projectRoleRequest.findMany.mockResolvedValue([
      { id: "eng-p1", domainId: "eng", level: "P1", slots: 1 },
      { id: "eng-p3", domainId: "eng", level: "P3", slots: 1 },
      { id: "ux-p1", domainId: "ux", level: "P1", slots: 2 },
    ]);
    const result = await setTermSpots(db, {
      ...input,
      roles: [
        { domainId: "eng", slots: 4 },
        { domainId: "des", slots: 2 },
      ],
    });
    expect(result).toBe("ok");
    expect(raw.$transaction).toHaveBeenCalledOnce();
    expect(tx.projectRoleRequest.findMany.mock.calls[0][0].where).toEqual({ projectId: "p1", termId: "t1" });
    expect(tx.projectRoleRequest.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["ux-p1"] } } });
    expect(tx.projectRoleRequest.update).toHaveBeenCalledWith({ where: { id: "eng-p1" }, data: { slots: 3 } });
    expect(tx.projectRoleRequest.createMany).toHaveBeenCalledWith({
      data: [{ projectId: "p1", termId: "t1", domainId: "des", level: "P1", slots: 2 }],
    });
  });

  it("merges duplicate domains and drops zero counts before writing", async () => {
    const { db, tx, raw } = fakeDb();
    await setTermSpots(db, {
      ...input,
      roles: [
        { domainId: "eng", slots: 1 },
        { domainId: "eng", slots: 2 },
        { domainId: "des", slots: 0 },
      ],
    });
    expect(raw.domain.findMany.mock.calls[0][0].where.id).toEqual({ in: ["eng"] });
    expect(tx.projectRoleRequest.createMany).toHaveBeenCalledWith({
      data: [{ projectId: "p1", termId: "t1", domainId: "eng", level: "P1", slots: 3 }],
    });
  });

  it("clears every spot for the term when given none, without a domain lookup", async () => {
    const { db, tx, raw } = fakeDb();
    tx.projectRoleRequest.findMany.mockResolvedValue([{ id: "a", domainId: "eng", level: "P1", slots: 2 }]);
    expect(await setTermSpots(db, { ...input, roles: [] })).toBe("ok");
    expect(raw.domain.findMany).not.toHaveBeenCalled();
    expect(tx.projectRoleRequest.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a"] } } });
    expect(tx.projectRoleRequest.createMany).not.toHaveBeenCalled();
  });
});
