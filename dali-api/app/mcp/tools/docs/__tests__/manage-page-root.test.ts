import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", async () => ({ requireForAction: (await import("~/mcp/errors")).requireForAction }));
vi.mock("~/lib/db.server", () => ({ prisma: { page: { findUnique: vi.fn(), update: vi.fn() } } }));
vi.mock("~/drive/lib/page-move.server", () => ({ movePage: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isLabMemberOrAlum: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/drive/lib/page-copy.server", () => ({ duplicatePage: vi.fn() }));
vi.mock("~/lib/user-pages.server", () => ({ setFavorite: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/mcp/tools/access", () => ({ canEditProject: vi.fn() }));
vi.mock("~/mcp/tools/update-page", () => ({ runUpdatePage: vi.fn() }));
vi.mock("~/mcp/tools/projects-extra/set-page-visibility", () => ({ runSetPageVisibility: vi.fn() }));

import { movePage } from "~/drive/lib/page-move.server";
import { MANAGE_PAGE_TOOL_DEF, runManagePage } from "~/mcp/tools/docs/manage-page";

const from = { workspaceType: "Lab" as const, workspaceId: null, parentPageId: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(movePage).mockResolvedValue({ ok: true, clearedReceivers: [], from });
});

describe("manage_page move goes through the Drive's own move", () => {
  it("moves a folder into a nested folder as the caller", async () => {
    const result = await runManagePage("u1", { action: "move", pageId: "decks", parentPageId: "core-partners" });
    expect(movePage).toHaveBeenCalledWith({
      pageId: "decks",
      userId: "u1",
      input: { parentPageId: "core-partners", beforeId: null },
    });
    expect(result).toEqual({ ok: true, clearedReceivers: [] });
  });

  it("moves to the top level and reorders before a sibling", async () => {
    await runManagePage("u1", { action: "move", pageId: "d1", parentPageId: null, beforeId: "d0" });
    expect(movePage).toHaveBeenCalledWith(
      expect.objectContaining({ input: { parentPageId: null, beforeId: "d0" } }),
    );
  });

  it("treats a missing parentPageId as the top level", async () => {
    await runManagePage("u1", { action: "move", pageId: "d1" });
    expect(movePage).toHaveBeenCalledWith(expect.objectContaining({ input: { parentPageId: null, beforeId: null } }));
  });

  it("passes a project destination with its id", async () => {
    await runManagePage("u1", { action: "move", pageId: "d1", parentPageId: null, workspaceType: "Project", workspaceId: "p1" });
    expect(movePage).toHaveBeenCalledWith(
      expect.objectContaining({ input: { parentPageId: null, beforeId: null, workspaceType: "Project", workspaceId: "p1" } }),
    );
  });

  it("sends a Lab destination with no workspace id, even if one is passed", async () => {
    await runManagePage("u1", { action: "move", pageId: "d1", parentPageId: null, workspaceType: "Lab", workspaceId: "p1" });
    expect(movePage).toHaveBeenCalledWith(
      expect.objectContaining({ input: { parentPageId: null, beforeId: null, workspaceType: "Lab", workspaceId: null } }),
    );
  });

  it("reports the receivers the move cleared", async () => {
    vi.mocked(movePage).mockResolvedValue({ ok: true, clearedReceivers: ["f1", "c1"], from });
    expect(await runManagePage("u1", { action: "move", pageId: "f1", parentPageId: null })).toEqual({
      ok: true,
      clearedReceivers: ["f1", "c1"],
    });
  });

  it("surfaces a refusal with its status and message", async () => {
    vi.mocked(movePage).mockResolvedValue({ ok: false, status: 400, error: "Drive roots can't be moved" });
    await expect(runManagePage("u1", { action: "move", pageId: "root1", parentPageId: null })).rejects.toMatchObject({
      name: "ManagePageError",
      status: 400,
      message: "Drive roots can't be moved",
    });
  });

  it("surfaces a refusal that came back as a response", async () => {
    vi.mocked(movePage).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "You can't manage this notebook" }, { status: 403 }),
    });
    await expect(runManagePage("u1", { action: "move", pageId: "d1", parentPageId: "nb1" })).rejects.toMatchObject({
      status: 403,
      message: "You can't manage this notebook",
    });
  });
});

describe("manage_page actions", () => {
  it("does not offer shortcut actions", () => {
    const actions = (MANAGE_PAGE_TOOL_DEF.inputSchema.properties.action as { enum: string[] }).enum;
    expect(actions).toEqual(["update", "set_visibility", "pin", "move", "duplicate", "favorite", "set_template", "typography"]);
  });
});
