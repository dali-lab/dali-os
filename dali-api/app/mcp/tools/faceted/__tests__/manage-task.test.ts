import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("../../create-task", async (orig) => ({ ...(await orig<object>()), runCreateTask: vi.fn() }));
vi.mock("../../update-task", async (orig) => ({ ...(await orig<object>()), runUpdateTask: vi.fn() }));
vi.mock("../../update-task-status", async (orig) => ({ ...(await orig<object>()), runUpdateTaskStatus: vi.fn() }));
vi.mock("../../delete-task", async (orig) => ({ ...(await orig<object>()), runDeleteTask: vi.fn() }));
vi.mock("../../set-task-checklist", async (orig) => ({ ...(await orig<object>()), runSetTaskChecklist: vi.fn() }));
vi.mock("../../link-task-to-github", async (orig) => ({ ...(await orig<object>()), runLinkTaskToGithub: vi.fn() }));
vi.mock("../../unlink-task-from-github", async (orig) => ({ ...(await orig<object>()), runUnlinkTaskFromGithub: vi.fn() }));

import { MANAGE_TASK_TOOL } from "../manage-task";
import { runCreateTask } from "../../create-task";
import { runUpdateTask } from "../../update-task";
import { runUpdateTaskStatus } from "../../update-task-status";
import { runDeleteTask } from "../../delete-task";
import { runSetTaskChecklist } from "../../set-task-checklist";
import { runLinkTaskToGithub } from "../../link-task-to-github";
import { runUnlinkTaskFromGithub } from "../../unlink-task-from-github";
import { McpInvalidError } from "../../../errors";

const ctx = { user: { id: "u1" }, scopes: ["mcp:write"], request: new Request("http://x") } as never;
const run = (args: Record<string, unknown>) => MANAGE_TASK_TOOL.run(ctx, args);
const props = MANAGE_TASK_TOOL.def.inputSchema.properties as Record<string, { enum?: string[]; items?: unknown }>;

beforeEach(() => vi.clearAllMocks());

describe("manage_task", () => {
  it("is one write tool with every task action", () => {
    expect(MANAGE_TASK_TOOL.def.name).toBe("manage_task");
    expect(MANAGE_TASK_TOOL.def.requiredScope).toBe("mcp:write");
    expect(props.action.enum).toEqual(["create", "update", "set_status", "set_checklist", "delete", "link_github", "unlink_github"]);
    expect(MANAGE_TASK_TOOL.def.inputSchema.required).toEqual(["action"]);
  });

  it("carries the fields every action needs", () => {
    for (const field of ["projectId", "core", "title", "taskId", "status", "priority", "assigneeUserIds", "mirrorToGithubRepo", "items", "repo"]) {
      expect(props).toHaveProperty(field);
    }
    expect(props.status.enum).toContain("Done");
  });

  it.each([
    ["create", { title: "T", projectId: "p1" }, runCreateTask, { title: "T", projectId: "p1" }],
    ["update", { taskId: "t1", title: "New", dueAt: "" }, runUpdateTask, { taskId: "t1", title: "New", dueAt: "" }],
    ["set_status", { taskId: "t1", status: "Done" }, runUpdateTaskStatus, { taskId: "t1", status: "Done" }],
    ["set_checklist", { taskId: "t1", items: [] }, runSetTaskChecklist, { taskId: "t1", items: [] }],
    ["delete", { taskId: "t1" }, runDeleteTask, { taskId: "t1" }],
    ["link_github", { taskId: "t1", repo: "o/r" }, runLinkTaskToGithub, { taskId: "t1", repo: "o/r" }],
    ["unlink_github", { taskId: "t1" }, runUnlinkTaskFromGithub, { taskId: "t1" }],
  ] as const)("%s calls its runner as the caller and returns its result", async (action, args, runner, expected) => {
    vi.mocked(runner).mockResolvedValue({ from: action } as never);
    await expect(run({ action, ...args })).resolves.toEqual({ from: action });
    expect(runner).toHaveBeenCalledWith("u1", expected);
  });

  it("passes each runner only its own fields", async () => {
    await run({ action: "update", taskId: "t1", title: "x", status: "Done", projectId: "p9", items: [] });
    expect(runUpdateTask).toHaveBeenCalledWith("u1", { taskId: "t1", title: "x" });
    await run({ action: "set_status", taskId: "t1", status: "Done", title: "ignored" });
    expect(runUpdateTaskStatus).toHaveBeenCalledWith("u1", { taskId: "t1", status: "Done" });
    await run({ action: "create", title: "T", core: true, taskId: "t1", repo: "o/r" });
    expect(runCreateTask).toHaveBeenCalledWith("u1", { title: "T", core: true });
  });

  it.each([
    ["create", {}],
    ["update", {}],
    ["set_status", { taskId: "t1" }],
    ["set_checklist", { taskId: "t1" }],
    ["delete", {}],
    ["link_github", { taskId: "t1" }],
    ["unlink_github", {}],
  ])("%s rejects missing required fields without calling a runner", async (action, args) => {
    await expect(run({ action, ...args })).rejects.toBeInstanceOf(McpInvalidError);
    for (const r of [runCreateTask, runUpdateTask, runUpdateTaskStatus, runSetTaskChecklist, runDeleteTask, runLinkTaskToGithub, runUnlinkTaskFromGithub]) {
      expect(r).not.toHaveBeenCalled();
    }
  });

  it("rejects an unknown action", async () => {
    await expect(run({ action: "archive", taskId: "t1" })).rejects.toBeInstanceOf(McpInvalidError);
  });

  it("lets a runner's error through", async () => {
    vi.mocked(runDeleteTask).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(run({ action: "delete", taskId: "t1" })).rejects.toMatchObject({ status: 403 });
  });
});
