import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    projectChartString: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db";
import { DALI_PROJECTS_GL } from "~/lib/chart-string";
import {
  resolveChartStringsForTerm,
  listChartStringsByProject,
} from "~/lib/chart-string.server";

const db = prisma as unknown as {
  projectChartString: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
};

const F26 = { code: "26F", sortKey: 20264 };
const S26 = { code: "26S", sortKey: 20262 };
const X26 = { code: "26X", sortKey: 20263 };

function own(projectId: string, termId: string, term: { code: string; sortKey: number }, normalized: string, type = "PTAEO") {
  return { projectId, termId, normalized, type, term };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.projectChartString.findMany.mockResolvedValue([]);
  db.projectChartString.findFirst.mockResolvedValue(null);
});

describe("resolveChartStringsForTerm", () => {
  it("uses the project's own row for the term", async () => {
    db.projectChartString.findMany.mockResolvedValue([
      own("p1", "t26f", F26, "521765.5000.B04373.XXXXX.330"),
    ]);
    const out = await resolveChartStringsForTerm("t26f", ["p1"]);
    expect(out.get("p1")).toEqual({
      normalized: "521765.5000.B04373.XXXXX.330",
      type: "PTAEO",
      source: "project",
      lastOwnTermCode: null,
    });
  });

  it("inherits the lab-default row when the project has none this term", async () => {
    db.projectChartString.findFirst.mockResolvedValue({
      normalized: "20.330.161028.128512.4000",
      type: "GL",
    });
    const out = await resolveChartStringsForTerm("t26f", ["p1"]);
    expect(out.get("p1")).toMatchObject({ source: "labDefault", type: "GL" });
    expect(db.projectChartString.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: null, termId: "t26f", isCurrent: true } }),
    );
  });

  it("falls back to the built-in lab projects GL when no default is recorded", async () => {
    const out = await resolveChartStringsForTerm("t26f", ["p1"]);
    expect(out.get("p1")).toEqual({
      normalized: DALI_PROJECTS_GL,
      type: "GL",
      source: "builtIn",
      lastOwnTermCode: null,
    });
  });

  it("names the latest other term the project had its own string in", async () => {
    // The sponsored project nobody re-entered for 26F.
    db.projectChartString.findMany.mockResolvedValue([
      own("p1", "t26s", S26, "521748.5000.B04369.XXXXX.722"),
      own("p1", "t26x", X26, "521748.5000.B04369.XXXXX.722"),
    ]);
    const out = await resolveChartStringsForTerm("t26f", ["p1"]);
    expect(out.get("p1")).toMatchObject({ source: "builtIn", lastOwnTermCode: "26X" });
  });

  it("answers for every project asked about, and only those", async () => {
    db.projectChartString.findMany.mockResolvedValue([
      own("p1", "t26f", F26, "18.722.161028.128512.3000", "GL"),
    ]);
    const out = await resolveChartStringsForTerm("t26f", ["p1", "p2", "p2"]);
    expect([...out.keys()].sort()).toEqual(["p1", "p2"]);
    expect(out.get("p1")?.source).toBe("project");
    expect(out.get("p2")?.source).toBe("builtIn");
  });

  it("skips the row query when there are no projects", async () => {
    const out = await resolveChartStringsForTerm("t26f", []);
    expect(out.size).toBe(0);
    expect(db.projectChartString.findMany).not.toHaveBeenCalled();
  });
});

describe("listChartStringsByProject", () => {
  it("collects every distinct string each project has held", async () => {
    db.projectChartString.findMany.mockResolvedValue([
      { projectId: "p1", normalized: "18.722.161028.128512.4000" },
      { projectId: "p1", normalized: "20.330.161028.128512.4000" },
      { projectId: "p1", normalized: "18.722.161028.128512.4000" },
      { projectId: "p2", normalized: "521765.5000.B04373.XXXXX.330" },
    ]);
    const out = await listChartStringsByProject();
    expect(out.get("p1")?.sort()).toEqual([
      "18.722.161028.128512.4000",
      "20.330.161028.128512.4000",
    ]);
    expect(out.get("p2")).toEqual(["521765.5000.B04373.XXXXX.330"]);
  });
});
