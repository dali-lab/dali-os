import { describe, it, expect } from "vitest";
import { groupFilesByEpic, type GroupableFile } from "../file-groups";

function file(id: string, taskLinked: boolean, epicIds: string[] = []): GroupableFile {
  return { id, taskLinked, epicIds };
}

const EPICS = [
  { id: "e1", title: "Onboarding redesign" },
  { id: "e2", title: "Spring campaign" },
];

describe("groupFilesByEpic", () => {
  it("splits files into epic groups, epicless work, and general uploads", () => {
    const { epicGroups, otherWorkFiles, generalFiles } = groupFilesByEpic(
      [
        file("hero", true, ["e1"]),
        file("poster", true, ["e2"]),
        file("adhoc", true),
        file("spec", false),
      ],
      EPICS,
    );

    expect(epicGroups.map((g) => ({ id: g.id, files: g.files.map((f) => f.id) }))).toEqual([
      { id: "e1", files: ["hero"] },
      { id: "e2", files: ["poster"] },
    ]);
    expect(otherWorkFiles.map((f) => f.id)).toEqual(["adhoc"]);
    expect(generalFiles.map((f) => f.id)).toEqual(["spec"]);
  });

  it("orders groups by the caller's epic order and skips empty epics", () => {
    const { epicGroups } = groupFilesByEpic([file("poster", true, ["e2"])], EPICS);
    expect(epicGroups.map((g) => g.title)).toEqual(["Spring campaign"]);
  });

  it("shows a multi-epic file under each epic", () => {
    const { epicGroups } = groupFilesByEpic([file("shared", true, ["e1", "e2"])], EPICS);
    expect(epicGroups.every((g) => g.files.some((f) => f.id === "shared"))).toBe(true);
  });

  it("falls back to the epicless bucket for unknown epic ids", () => {
    const { epicGroups, otherWorkFiles } = groupFilesByEpic(
      [file("stray", true, ["deleted-epic"])],
      EPICS,
    );
    expect(epicGroups).toEqual([]);
    expect(otherWorkFiles.map((f) => f.id)).toEqual(["stray"]);
  });

  it("leaves everything general when nothing is task-linked", () => {
    const { epicGroups, otherWorkFiles, generalFiles } = groupFilesByEpic(
      [file("a", false), file("b", false)],
      EPICS,
    );
    expect(epicGroups).toEqual([]);
    expect(otherWorkFiles).toEqual([]);
    expect(generalFiles.map((f) => f.id)).toEqual(["a", "b"]);
  });
});
