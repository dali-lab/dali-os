import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", async () => {
  const { requireForAction } = await import("~/mcp/errors");
  return { requireForAction };
});
vi.mock("~/lib/notebooks.server", () => ({
  addToNotebook: vi.fn(),
  attachNote: vi.fn(),
  createNotebook: vi.fn(),
  detachNote: vi.fn(),
  dissolveNotebook: vi.fn(),
  mergeNotebooks: vi.fn(),
  setNotebookTemplate: vi.fn(),
  setSeriesNotebook: vi.fn(),
  trashNotebook: vi.fn(),
}));

import * as lib from "~/lib/notebooks.server";
import { MANAGE_NOTEBOOK, MANAGE_NOTEBOOK_TOOL_DEF, runManageNotebook } from "../manage-notebook";

const run = (input: Record<string, unknown>) => runManageNotebook("u1", input as never);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("manage_notebook definition", () => {
  it("requires mcp:write and lists every action", () => {
    expect(MANAGE_NOTEBOOK_TOOL_DEF.requiredScope).toBe("mcp:write");
    expect(MANAGE_NOTEBOOK_TOOL_DEF.inputSchema.properties.action.enum).toEqual([
      "create",
      "set_template",
      "add_page",
      "detach_note",
      "attach_note",
      "merge_into",
      "dissolve",
      "trash",
      "set_series_notebook",
    ]);
  });

  it("runs as the calling user", async () => {
    vi.mocked(lib.trashNotebook).mockResolvedValue(undefined);
    await MANAGE_NOTEBOOK.run({ user: { id: "u9" } } as never, { action: "trash", notebookId: "nb1" });
    expect(lib.trashNotebook).toHaveBeenCalledWith("nb1", "u9");
  });
});

describe("manage_notebook required fields", () => {
  it.each([
    ["create", { title: "x" }],
    ["create", { workspaceType: "Lab" }],
    ["set_template", {}],
    ["add_page", { notebookId: "nb1" }],
    ["add_page", { pageId: "d1" }],
    ["detach_note", {}],
    ["attach_note", { pageId: "d1" }],
    ["attach_note", { meetingId: "m1" }],
    ["merge_into", { notebookId: "nb1" }],
    ["dissolve", {}],
    ["trash", {}],
    ["set_series_notebook", { meetingId: "m1" }],
    ["set_series_notebook", { scope: "all" }],
  ])("%s rejects %j", async (action, rest) => {
    await expect(run({ action, ...rest })).rejects.toMatchObject({ status: 400 });
    for (const fn of Object.values(lib)) expect(fn).not.toHaveBeenCalled();
  });

  it("rejects an unknown action", async () => {
    await expect(run({ action: "explode" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("manage_notebook actions", () => {
  it("create", async () => {
    vi.mocked(lib.createNotebook).mockResolvedValue({ id: "nb9" });
    const out = await run({ action: "create", title: "Standups", workspaceType: "Project", workspaceId: "p1", parentPageId: "f1", templatePageId: "t1" });
    expect(out).toEqual({ id: "nb9" });
    expect(lib.createNotebook).toHaveBeenCalledWith({
      title: "Standups",
      workspaceType: "Project",
      workspaceId: "p1",
      parentPageId: "f1",
      templatePageId: "t1",
      actorId: "u1",
    });
  });

  it("create defaults the optional placement to null", async () => {
    vi.mocked(lib.createNotebook).mockResolvedValue({ id: "nb9" });
    await run({ action: "create", title: "Standups", workspaceType: "Lab" });
    expect(lib.createNotebook).toHaveBeenCalledWith({
      title: "Standups",
      workspaceType: "Lab",
      workspaceId: null,
      parentPageId: null,
      templatePageId: null,
      actorId: "u1",
    });
  });

  it("set_template sets and, with no templatePageId, clears", async () => {
    await run({ action: "set_template", notebookId: "nb1", templatePageId: "t1" });
    expect(lib.setNotebookTemplate).toHaveBeenLastCalledWith("nb1", "t1", "u1");
    expect(await run({ action: "set_template", notebookId: "nb1" })).toEqual({ ok: true });
    expect(lib.setNotebookTemplate).toHaveBeenLastCalledWith("nb1", null, "u1");
  });

  it("add_page", async () => {
    expect(await run({ action: "add_page", notebookId: "nb1", pageId: "d1" })).toEqual({ ok: true });
    expect(lib.addToNotebook).toHaveBeenCalledWith("d1", "nb1", "u1");
  });

  it("detach_note", async () => {
    expect(await run({ action: "detach_note", pageId: "d1" })).toEqual({ ok: true });
    expect(lib.detachNote).toHaveBeenCalledWith("d1", "u1");
  });

  it("attach_note parses the occurrence and reports the notebook move", async () => {
    vi.mocked(lib.attachNote).mockResolvedValue({ movedIntoNotebook: true });
    const out = await run({ action: "attach_note", pageId: "d1", meetingId: "m1", occurrenceStart: "2026-09-10T15:00:00.000Z" });
    expect(out).toEqual({ ok: true, movedIntoNotebook: true });
    expect(lib.attachNote).toHaveBeenCalledWith("d1", "m1", new Date("2026-09-10T15:00:00.000Z"), "u1");
  });

  it("attach_note without an occurrence means the first one, and rejects a bad date", async () => {
    vi.mocked(lib.attachNote).mockResolvedValue({ movedIntoNotebook: false });
    await run({ action: "attach_note", pageId: "d1", meetingId: "m1" });
    expect(lib.attachNote).toHaveBeenCalledWith("d1", "m1", null, "u1");
    await expect(run({ action: "attach_note", pageId: "d1", meetingId: "m1", occurrenceStart: "tuesday" })).rejects.toMatchObject({ status: 400 });
  });

  it("merge_into", async () => {
    vi.mocked(lib.mergeNotebooks).mockResolvedValue({ moved: 4 });
    expect(await run({ action: "merge_into", notebookId: "nb1", targetId: "nb2" })).toEqual({ ok: true, moved: 4 });
    expect(lib.mergeNotebooks).toHaveBeenCalledWith("nb1", "nb2", "u1");
  });

  it("dissolve", async () => {
    vi.mocked(lib.dissolveNotebook).mockResolvedValue({ moved: 2 });
    expect(await run({ action: "dissolve", notebookId: "nb1" })).toEqual({ ok: true, moved: 2 });
    expect(lib.dissolveNotebook).toHaveBeenCalledWith("nb1", "u1");
  });

  it("trash", async () => {
    expect(await run({ action: "trash", notebookId: "nb1" })).toEqual({ ok: true });
    expect(lib.trashNotebook).toHaveBeenCalledWith("nb1", "u1");
  });

  it("set_series_notebook sets, and unsets when notebookId is omitted", async () => {
    vi.mocked(lib.setSeriesNotebook).mockResolvedValue({ moved: 2, skipped: 0 });
    expect(await run({ action: "set_series_notebook", meetingId: "m1", notebookId: "nb1", scope: "all" })).toEqual({
      ok: true,
      moved: 2,
      skipped: 0,
    });
    expect(lib.setSeriesNotebook).toHaveBeenLastCalledWith("m1", "nb1", { scope: "all" }, "u1");
    await run({ action: "set_series_notebook", meetingId: "m1", scope: "future" });
    expect(lib.setSeriesNotebook).toHaveBeenLastCalledWith("m1", null, { scope: "future" }, "u1");
  });
});

describe("manage_notebook authorization", () => {
  const refusal = Object.assign(new Error("Only the organizer or Core can change a meeting's notebook"), { status: 403 });

  it.each([
    ["create", { action: "create", title: "x", workspaceType: "Lab" }, "createNotebook"],
    ["set_template", { action: "set_template", notebookId: "nb1" }, "setNotebookTemplate"],
    ["add_page", { action: "add_page", notebookId: "nb1", pageId: "d1" }, "addToNotebook"],
    ["detach_note", { action: "detach_note", pageId: "d1" }, "detachNote"],
    ["attach_note", { action: "attach_note", pageId: "d1", meetingId: "m1" }, "attachNote"],
    ["merge_into", { action: "merge_into", notebookId: "nb1", targetId: "nb2" }, "mergeNotebooks"],
    ["dissolve", { action: "dissolve", notebookId: "nb1" }, "dissolveNotebook"],
    ["trash", { action: "trash", notebookId: "nb1" }, "trashNotebook"],
    ["set_series_notebook", { action: "set_series_notebook", meetingId: "m1", scope: "all" }, "setSeriesNotebook"],
  ] as const)("%s surfaces the library's 403 with its status", async (_action, input, fn) => {
    (lib[fn] as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(refusal);
    await expect(run(input)).rejects.toMatchObject({ status: 403 });
  });
});
