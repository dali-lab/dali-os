import { describe, expect, it } from "vitest";
import { filterCoreTasks, parseAssigneeParam } from "~/core/lib/taskboard";
import type { TaskCardModel } from "~/projects/lib/task-board";

const task = (id: string, title: string, assigneeIds: string[]) =>
  ({
    id,
    title,
    description: null,
    domain: null,
    assignees: assigneeIds.map((a) => ({ id: a, name: `Person ${a}` })),
  }) as unknown as TaskCardModel;

const tasks = [task("1", "Plan retreat", ["a"]), task("2", "Send agenda", ["b"]), task("3", "Book room", [])];
const base = { assigneeIds: [], mine: false, currentUserId: "a", query: "" };

describe("parseAssigneeParam", () => {
  it("splits a comma list and ignores empties", () => {
    expect(parseAssigneeParam("a,b")).toEqual(["a", "b"]);
    expect(parseAssigneeParam("")).toEqual([]);
    expect(parseAssigneeParam("a,,b")).toEqual(["a", "b"]);
  });
});

describe("filterCoreTasks", () => {
  it("returns everything with no filters", () => {
    expect(filterCoreTasks(tasks, base)).toHaveLength(3);
  });

  it("only mine keeps tasks assigned to the viewer", () => {
    expect(filterCoreTasks(tasks, { ...base, mine: true }).map((t) => t.id)).toEqual(["1"]);
  });

  it("assignee filter keeps tasks with any chosen assignee", () => {
    expect(filterCoreTasks(tasks, { ...base, assigneeIds: ["b"] }).map((t) => t.id)).toEqual(["2"]);
    expect(filterCoreTasks(tasks, { ...base, assigneeIds: ["a", "b"] }).map((t) => t.id)).toEqual(["1", "2"]);
  });

  it("combines mine, assignee and search", () => {
    expect(filterCoreTasks(tasks, { ...base, mine: true, assigneeIds: ["b"] })).toEqual([]);
    expect(filterCoreTasks(tasks, { ...base, query: "agenda" }).map((t) => t.id)).toEqual(["2"]);
  });
});

