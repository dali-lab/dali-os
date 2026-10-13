import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpInvalidError extends Error {
    status = 400;
  }
  function requireForAction(action: string, args: Record<string, unknown>, spec: Record<string, string[]>) {
    const required = spec[action];
    if (!required) throw new McpInvalidError(`Unknown action '${action}'`);
    const missing = required.filter((k) => args[k] === undefined || args[k] === null);
    if (missing.length) throw new McpInvalidError(`action '${action}' requires: ${missing.join(", ")}`);
  }
  return { requireForAction };
});
vi.mock("~/lib/db", () => ({ prisma: { page: {} } }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMember: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/mcp/tools/access", () => ({ canEditProject: vi.fn() }));
vi.mock("~/lib/page-copy.server", () => ({ duplicatePage: vi.fn() }));
vi.mock("~/lib/user-pages.server", () => ({ setFavorite: vi.fn() }));
vi.mock("~/lib/page-share-access.server", () => ({ canManageSharing: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/pages", () => ({ pageDepth: vi.fn(), MAX_PAGE_DEPTH: 6, isAncestorOf: vi.fn() }));
vi.mock("~/lib/drive-receivers.server", () => ({ clearTypeIfLeavingRoot: vi.fn() }));
vi.mock("~/lib/shortcuts.server", () => {
  class ShortcutError extends Error {
    constructor(
      message: string,
      readonly status = 400,
    ) {
      super(message);
    }
  }
  return { createShortcut: vi.fn(), deleteShortcut: vi.fn(), ShortcutError };
});

import { runManagePage, MANAGE_PAGE_TOOL_DEF } from "~/mcp/tools/docs/manage-page";
import { createShortcut, deleteShortcut, ShortcutError } from "~/lib/shortcuts.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manage_page create_shortcut", () => {
  it("is offered in the tool schema", () => {
    expect(MANAGE_PAGE_TOOL_DEF.inputSchema.properties.action.enum).toEqual(
      expect.arrayContaining(["create_shortcut", "delete_shortcut"]),
    );
  });

  it("puts a shortcut to the page in a project folder as the caller", async () => {
    vi.mocked(createShortcut).mockResolvedValue({
      shortcutId: "s1",
      created: true,
      grantShareId: "sh1",
      grantDeclined: false,
    });

    const result = await runManagePage("u1", {
      action: "create_shortcut",
      pageId: "p1",
      workspaceType: "Project",
      workspaceId: "proj1",
      parentPageId: "f1",
    });

    expect(createShortcut).toHaveBeenCalledWith({
      targetPageId: "p1",
      dest: { workspaceType: "Project", workspaceId: "proj1", parentPageId: "f1" },
      actorId: "u1",
    });
    expect(result).toEqual({ ok: true, shortcutId: "s1", created: true, grantDeclined: false });
  });

  it("files at the top of the Lab drive with no workspace id and reports a declined grant", async () => {
    vi.mocked(createShortcut).mockResolvedValue({
      shortcutId: "s1",
      created: true,
      grantShareId: null,
      grantDeclined: true,
    });

    const result = await runManagePage("u1", {
      action: "create_shortcut",
      pageId: "p1",
      workspaceType: "Lab",
      workspaceId: "ignored",
    });

    expect(createShortcut).toHaveBeenCalledWith(
      expect.objectContaining({ dest: { workspaceType: "Lab", workspaceId: null, parentPageId: null } }),
    );
    expect(result).toMatchObject({ grantDeclined: true });
  });

  it("requires a destination workspace type", async () => {
    await expect(runManagePage("u1", { action: "create_shortcut", pageId: "p1" })).rejects.toMatchObject({
      status: 400,
    });
    expect(createShortcut).not.toHaveBeenCalled();
  });

  it("requires a workspace id for a project destination", async () => {
    await expect(
      runManagePage("u1", { action: "create_shortcut", pageId: "p1", workspaceType: "Project" }),
    ).rejects.toMatchObject({ name: "ManagePageError", status: 400 });
    expect(createShortcut).not.toHaveBeenCalled();
  });

  it("maps a refusal to the same status", async () => {
    vi.mocked(createShortcut).mockRejectedValue(new ShortcutError("You can't put things in that folder", 403));

    await expect(
      runManagePage("u1", { action: "create_shortcut", pageId: "p1", workspaceType: "Lab" }),
    ).rejects.toMatchObject({ name: "ManagePageError", status: 403, message: "You can't put things in that folder" });
  });
});

describe("manage_page delete_shortcut", () => {
  it("deletes the shortcut as the caller", async () => {
    vi.mocked(deleteShortcut).mockResolvedValue(undefined);

    const result = await runManagePage("u1", { action: "delete_shortcut", pageId: "s1" });

    expect(deleteShortcut).toHaveBeenCalledWith("s1", "u1");
    expect(result).toEqual({ ok: true });
  });

  it("maps a missing shortcut to 404", async () => {
    vi.mocked(deleteShortcut).mockRejectedValue(new ShortcutError("Shortcut not found", 404));

    await expect(runManagePage("u1", { action: "delete_shortcut", pageId: "s1" })).rejects.toMatchObject({
      name: "ManagePageError",
      status: 404,
    });
  });
});
