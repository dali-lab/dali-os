import { describe, expect, it } from "vitest";
import { backlogCount, buildBacklogGroups, groupMeta, isGroupRelevant, LOOSE_GROUP_KEY, type BacklogTask } from "../backlog-groups";

const ms = [
  { id: "b", periodId: "p", name: "Workshops", startWeek: 2, endWeek: 9 },
  { id: "a", periodId: "p", name: "Instructors", startWeek: 1, endWeek: 5 },
  { id: "c", periodId: "p", name: "Empty", startWeek: 3, endWeek: 4 },
  { id: "z", periodId: "other", name: "Other term", startWeek: 1, endWeek: 2 },
];
const t = (id: string, milestoneId: string | null, week: number, status: BacklogTask["status"] = "Backlog", periodId = "p"): BacklogTask => ({
  id, milestoneId, week, status, periodId,
});
const all = () => true;
const build = (tasks: BacklogTask[], extra: Partial<Parameters<typeof buildBacklogGroups<BacklogTask>>[0]> = {}) =>
  buildBacklogGroups({ tasks, milestones: ms, scope: "term", periodId: "p", show: all, ...extra });

describe("buildBacklogGroups", () => {
  it("orders groups by milestone start week and rows by week, loose last", () => {
    const groups = build([t("1", "b", 4), t("2", "a", 5), t("3", "b", 2), t("4", "a", 1), t("5", null, 3)]);
    expect(groups.map((g) => [g.name, g.rows.map((r) => r.id)])).toEqual([
      ["Instructors", ["4", "2"]],
      ["Workshops", ["3", "1"]],
      ["Loose tasks", ["5"]],
    ]);
  });

  it("keeps a milestone with only non-backlog tasks and counts every status", () => {
    const groups = build([t("1", "a", 1, "Done"), t("2", "a", 2, "Todo"), t("3", "a", 3)]);
    const a = groups.find((g) => g.key === "a")!;
    expect(a.rows.map((r) => r.id)).toEqual(["3"]);
    expect([a.done, a.total]).toEqual([1, 3]);
  });

  it("drops milestones with no tasks at all", () => {
    expect(build([t("1", "a", 1)]).map((g) => g.key)).toEqual(["a", LOOSE_GROUP_KEY]);
  });

  it("scopes milestones to the viewed period unless the scope is the whole year", () => {
    const tasks = [t("1", "z", 1, "Backlog", "other"), t("2", "a", 1)];
    expect(build(tasks).map((g) => g.key)).toEqual(["a", LOOSE_GROUP_KEY]);
    expect(build(tasks, { scope: "year" }).map((g) => g.key)).toEqual(["a", "z", LOOSE_GROUP_KEY]);
  });

  it("scopes loose tasks the same way", () => {
    const tasks = [t("1", null, 1, "Backlog", "other"), t("2", null, 1)];
    expect(build(tasks).at(-1)!.rows.map((r) => r.id)).toEqual(["2"]);
    expect(build(tasks, { scope: "year" }).at(-1)!.rows.map((r) => r.id).sort()).toEqual(["1", "2"]);
  });

  it("treats a task pointing at a missing milestone as loose", () => {
    expect(build([t("1", "gone", 2)]).at(-1)!.rows.map((r) => r.id)).toEqual(["1"]);
  });

  it("applies the visibility filter to rows but not to milestone counts", () => {
    const groups = build([t("1", "a", 1), t("2", "a", 2)], { show: (x) => x.id === "1" });
    expect(groups[0].rows.map((r) => r.id)).toEqual(["1"]);
    expect(groups[0].total).toBe(2);
  });

  it("always includes the loose group, even when empty", () => {
    expect(build([]).map((g) => g.key)).toEqual([LOOSE_GROUP_KEY]);
  });

  it("breaks start-week ties by name", () => {
    const tie = [
      { id: "x", periodId: "p", name: "Zed", startWeek: 1, endWeek: 2 },
      { id: "y", periodId: "p", name: "Alpha", startWeek: 1, endWeek: 2 },
    ];
    const g = buildBacklogGroups({ tasks: [t("1", "x", 1), t("2", "y", 1)], milestones: tie, scope: "term", periodId: "p", show: all });
    expect(g.map((x) => x.name).slice(0, 2)).toEqual(["Alpha", "Zed"]);
  });
});

describe("backlogCount and groupMeta", () => {
  it("sums visible rows across groups", () => {
    expect(backlogCount(build([t("1", "a", 1), t("2", null, 1), t("3", "a", 2, "Done")]))).toBe(2);
  });

  it("describes milestones as week span and progress, loose as waiting", () => {
    const groups = build([t("1", "a", 1), t("2", "a", 2, "Done"), t("3", null, 1), t("4", null, 2)]);
    expect(groupMeta(groups[0])).toBe("Wk 1 to 5 · 1/2");
    expect(groupMeta(groups[1])).toBe("2 waiting");
  });
});

describe("isGroupRelevant", () => {
  const groups = () => build([t("1", "a", 1), t("2", "b", 3), t("3", null, 7), t("4", null, 2)]);
  const find = (key: string) => groups().find((g) => g.key === key)!;

  it("is open for the milestone whose weeks contain the viewed week", () => {
    expect(isGroupRelevant(find("a"), { periodId: "p", week: 4 })).toBe(true);
    expect(isGroupRelevant(find("a"), { periodId: "p", week: 5 })).toBe(true);
    expect(isGroupRelevant(find("a"), { periodId: "p", week: 6 })).toBe(false);
  });

  it("includes both ends of the span", () => {
    expect(isGroupRelevant(find("b"), { periodId: "p", week: 2 })).toBe(true);
    expect(isGroupRelevant(find("b"), { periodId: "p", week: 9 })).toBe(true);
    expect(isGroupRelevant(find("b"), { periodId: "p", week: 10 })).toBe(false);
  });

  it("never matches a milestone from another period", () => {
    expect(isGroupRelevant(find("a"), { periodId: "other", week: 3 })).toBe(false);
  });

  it("opens loose tasks only when one is planned for the viewed week", () => {
    expect(isGroupRelevant(find(LOOSE_GROUP_KEY), { periodId: "p", week: 7 })).toBe(true);
    expect(isGroupRelevant(find(LOOSE_GROUP_KEY), { periodId: "p", week: 8 })).toBe(false);
  });
});
