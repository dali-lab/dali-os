import { describe, it, expect } from "vitest";
import {
  OPEN_TO_CHOICES,
  WALL_FILL_ORDER,
  WALL_SIZE,
  blockById,
  blockIdFor,
  classTag,
  joinRoles,
  parseJsonList,
  splitWork,
  summarizeDali,
  wallFilledForStep,
} from "../alumni-onboarding";

describe("wall", () => {
  it("has 18 distinct blocks, none sharing a cell", () => {
    expect(WALL_FILL_ORDER).toHaveLength(WALL_SIZE);
    const cells = new Set(WALL_FILL_ORDER.map((t) => `${t.col},${t.row}`));
    expect(cells.size).toBe(WALL_SIZE);
  });

  it("fills 8, 13 and 18 blocks across the three steps", () => {
    expect([1, 2, 3].map(wallFilledForStep)).toEqual([8, 13, 18]);
    expect(wallFilledForStep(0)).toBe(8);
    expect(wallFilledForStep(9)).toBe(18);
  });
});

describe("finished block", () => {
  it("is stable per user and never an empty or loose tile", () => {
    expect(blockIdFor("user-1")).toBe(blockIdFor("user-1"));
    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) {
      const block = blockById(blockIdFor(id));
      expect(["solid", "loose"]).not.toContain(block.motif);
    }
  });
});

describe("open-to choices", () => {
  it("lists the five designed tiles in order", () => {
    expect(OPEN_TO_CHOICES.map((c) => c.title)).toEqual([
      "Coffee chats",
      "Resume reviews",
      "Partner referrals",
      "Mentor a project",
      "Speak at a lab event",
    ]);
  });
});

describe("summarizeDali", () => {
  const row = (project: string, term: string, sortKey: number, domain: string) => ({
    project: { id: project, name: project },
    term: { id: term, sortKey },
    domain: { displayName: domain },
  });

  it("counts distinct projects and terms and orders roles by term", () => {
    const s = summarizeDali([
      row("Hood", "t2", 2, "Design"),
      row("Habitat", "t1", 1, "Development"),
      row("Habitat", "t2", 2, "Design"),
    ]);
    expect(s).toEqual({
      projectCount: 2,
      termCount: 2,
      projectNames: ["Habitat", "Hood"],
      roles: ["Development", "Design"],
    });
    expect(joinRoles(s.roles)).toBe("Development, then design");
  });

  it("is empty for someone with no projects", () => {
    expect(summarizeDali([])).toEqual({ projectCount: 0, termCount: 0, projectNames: [], roles: [] });
  });
});

describe("splitWork", () => {
  const job = (id: string, endDate: Date | null) => ({ id, company: "C", position: "P", location: null, endDate });

  it("takes the first current job as now and the next row as before", () => {
    const rows = [job("a", null), job("b", new Date("2023-06-01"))];
    expect(splitWork(rows).now?.id).toBe("a");
    expect(splitWork(rows).before?.id).toBe("b");
  });

  it("has no now when every job has ended", () => {
    const rows = [job("a", new Date("2024-01-01")), job("b", new Date("2023-01-01"))];
    expect(splitWork(rows)).toMatchObject({ now: null, before: { id: "a" } });
  });
});

describe("helpers", () => {
  it("builds the name tag with a two digit class year", () => {
    expect(classTag("Ada Lovelace", 2024)).toBe("Ada Lovelace '24");
    expect(classTag("Ada Lovelace", null)).toBe("Ada Lovelace");
  });

  it("parses the topic list and drops anything that is not a string list", () => {
    expect(parseJsonList('["a","b",3]')).toEqual(["a", "b"]);
    expect(parseJsonList("nope")).toEqual([]);
    expect(parseJsonList('{"a":1}')).toEqual([]);
  });
});
