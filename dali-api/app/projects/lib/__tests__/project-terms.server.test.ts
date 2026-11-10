import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { replaceProjectTerms } from "../project-terms.server";

const db = prisma as unknown as Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction = vi.fn().mockResolvedValue([]);
  db.term = { findMany: vi.fn() };
  db.projectTerm = { deleteMany: vi.fn(), createMany: vi.fn() };
});

describe("replaceProjectTerms", () => {
  it("deletes only removed terms, so kept rows keep their PI", async () => {
    db.term.findMany.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    await replaceProjectTerms("p", ["t1", "t2"]);
    expect(db.projectTerm.deleteMany).toHaveBeenCalledWith({ where: { projectId: "p", termId: { notIn: ["t1", "t2"] } } });
    expect(db.projectTerm.createMany).toHaveBeenCalledWith({
      data: [
        { projectId: "p", termId: "t1" },
        { projectId: "p", termId: "t2" },
      ],
      skipDuplicates: true,
    });
  });

  it("drops unknown term ids", async () => {
    db.term.findMany.mockResolvedValue([{ id: "t1" }]);
    await replaceProjectTerms("p", ["t1", "nope"]);
    expect(db.projectTerm.createMany.mock.calls[0][0].data).toEqual([{ projectId: "p", termId: "t1" }]);
  });

  it("clears every term when given none", async () => {
    await replaceProjectTerms("p", []);
    expect(db.projectTerm.deleteMany).toHaveBeenCalledWith({ where: { projectId: "p", termId: { notIn: [] } } });
    expect(db.projectTerm.createMany).not.toHaveBeenCalled();
  });
});
