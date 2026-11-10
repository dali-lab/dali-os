import { describe, it, expect } from "vitest";
import { isProjectListOperation, withStandardProjectsOnly } from "~/lib/project-kind-filter";

describe("withStandardProjectsOnly", () => {
  it("adds kind Standard next to existing filters", () => {
    expect(withStandardProjectsOnly({ where: { status: "Active" }, take: 5 })).toEqual({
      where: { status: "Active", kind: "Standard" },
      take: 5,
    });
  });

  it("creates a where when the caller passed none", () => {
    expect(withStandardProjectsOnly({ orderBy: { name: "asc" } })).toEqual({
      orderBy: { name: "asc" },
      where: { kind: "Standard" },
    });
    expect(withStandardProjectsOnly(undefined)).toEqual({ where: { kind: "Standard" } });
    expect(withStandardProjectsOnly({ where: null })).toEqual({ where: { kind: "Standard" } });
  });

  it("respects an explicit kind", () => {
    const args = { where: { kind: "CoreBoard" }, select: { id: true } };
    expect(withStandardProjectsOnly(args)).toEqual(args);
  });

  it("does not mutate the caller's args", () => {
    const where = { status: "Active" };
    withStandardProjectsOnly({ where });
    expect(where).toEqual({ status: "Active" });
  });
});

describe("isProjectListOperation", () => {
  it("covers the list reads on Project only", () => {
    for (const op of ["findMany", "findFirst", "count", "aggregate", "groupBy"]) {
      expect(isProjectListOperation("Project", op)).toBe(true);
    }
    expect(isProjectListOperation("Project", "findUnique")).toBe(false);
    expect(isProjectListOperation("Project", "update")).toBe(false);
    expect(isProjectListOperation("Task", "findMany")).toBe(false);
  });
});
