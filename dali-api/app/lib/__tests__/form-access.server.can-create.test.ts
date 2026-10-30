import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/pageAccess.server", () => ({ PAGE_ACCESS_SELECT: { id: true }, getPageAccess: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isLabMember: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { isLabMember } from "~/lib/roles";
import { canCreateForm, canManageFormPlacement } from "~/forms/lib/form-access.server";

const access = (canEdit: boolean) => ({ canView: true, canEdit, canComment: canEdit }) as never;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("canCreateForm", () => {
  it("with no folder, any lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    expect(await canCreateForm("u1", null)).toBe(true);
    vi.mocked(isLabMember).mockResolvedValue(false);
    expect(await canCreateForm("u1", undefined)).toBe(false);
  });

  it("in a folder, edit access on the folder page", async () => {
    (prisma as any).page.findUnique.mockResolvedValue({ id: "folder-1" });
    vi.mocked(getPageAccess).mockResolvedValue(access(true));
    expect(await canCreateForm("u1", "folder-1")).toBe(true);
    vi.mocked(getPageAccess).mockResolvedValue(access(false));
    expect(await canCreateForm("u1", "folder-1")).toBe(false);
    expect((prisma as any).page.findUnique.mock.calls[0][0].where).toEqual({ id: "folder-1", kind: "Folder" });
  });

  it("a folder that does not exist", async () => {
    (prisma as any).page.findUnique.mockResolvedValue(null);
    expect(await canCreateForm("u1", "gone")).toBe(false);
  });
});

describe("canManageFormPlacement", () => {
  it("is edit on the form's page", async () => {
    (prisma as any).page.findUnique.mockResolvedValue({ id: "f1" });
    vi.mocked(getPageAccess).mockResolvedValue(access(false));
    expect(await canManageFormPlacement("u1", "f1")).toBe(false);
    vi.mocked(getPageAccess).mockResolvedValue(access(true));
    expect(await canManageFormPlacement("u1", "f1")).toBe(true);
  });
});
