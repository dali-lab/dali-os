import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", async () => ({ requireForAction: (await import("~/mcp/errors")).requireForAction }));
vi.mock("~/lib/db.server", () => ({ prisma: { page: { findUnique: vi.fn(), update: vi.fn() } } }));
vi.mock("~/mcp/tools/update-page", () => ({ runUpdatePage: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isLabMemberOrAlum: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/drive/lib/page-copy.server", () => ({ duplicatePage: vi.fn() }));
vi.mock("~/lib/user-pages.server", () => ({ setFavorite: vi.fn() }));
vi.mock("~/lib/page-share-access.server", () => ({ canManageSharing: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/drive/lib/page-move.server", () => ({ movePage: vi.fn() }));
vi.mock("~/mcp/tools/access", () => ({ canEditProject: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { runUpdatePage } from "~/mcp/tools/update-page";
import { MANAGE_PAGE_TOOL_DEF, runManagePage } from "~/mcp/tools/docs/manage-page";

beforeEach(() => vi.clearAllMocks());

describe("manage_page update", () => {
  it("renames and re-icons through the project page rules as the caller", async () => {
    vi.mocked(runUpdatePage).mockResolvedValue({ id: "p1" } as never);
    const out = await runManagePage("u1", { action: "update", pageId: "p1", title: "Plan", iconEmoji: "" });
    expect(out).toEqual({ id: "p1" });
    expect(runUpdatePage).toHaveBeenCalledWith("u1", { pageId: "p1", title: "Plan", iconEmoji: "" });
  });

  it("passes only the update fields, so update can't move a page", async () => {
    await runManagePage("u1", { action: "update", pageId: "p1", title: "Plan", parentPageId: "f1", pinned: true } as never);
    expect(runUpdatePage).toHaveBeenCalledWith("u1", { pageId: "p1", title: "Plan", iconEmoji: undefined });
  });

  it("lets the update runner's errors through", async () => {
    vi.mocked(runUpdatePage).mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(runManagePage("u1", { action: "update", pageId: "p1", title: "x" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("manage_page overlap with other tools", () => {
  it("leaves trash to manage_drive_trash and visibility to share_page", async () => {
    const props = MANAGE_PAGE_TOOL_DEF.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props.action.enum).not.toContain("set_visibility");
    for (const field of ["archived", "audience", "visible"]) expect(props).not.toHaveProperty(field);
    expect(props).toHaveProperty("pinned");
    await expect(runManagePage("u1", { action: "set_visibility", pageId: "p1" } as never)).rejects.toMatchObject({ status: 400 });
    expect(prisma.page.update).not.toHaveBeenCalled();
  });
});
