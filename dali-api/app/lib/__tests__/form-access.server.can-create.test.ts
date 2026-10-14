import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabledForEveryone: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ PAGE_ACCESS_SELECT: { id: true }, getPageAccess: vi.fn() }));
vi.mock("~/lib/roles", () => ({ canViewForms: vi.fn(), isCore: vi.fn(), isLabMember: vi.fn() }));

import { prisma } from "~/lib/db";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canViewForms, isLabMember } from "~/lib/roles";
import { canCreateForm, canManageFormPlacement } from "~/forms/lib/form-access.server";

const access = (canEdit: boolean) => ({ canView: true, canEdit, canComment: canEdit }) as never;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("canCreateForm", () => {
  it("flag off: the canViewForms gate, folder ignored", async () => {
    vi.mocked(isFeatureEnabledForEveryone).mockResolvedValue(false);
    vi.mocked(canViewForms).mockResolvedValue(true);
    expect(await canCreateForm("u1", "folder-1")).toBe(true);
    vi.mocked(canViewForms).mockResolvedValue(false);
    expect(await canCreateForm("u1", null)).toBe(false);
    expect(getPageAccess).not.toHaveBeenCalled();
  });

  describe("flag on", () => {
    beforeEach(() => vi.mocked(isFeatureEnabledForEveryone).mockResolvedValue(true));

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
});

describe("canManageFormPlacement", () => {
  it("flag off: canViewForms, which is wider than build", async () => {
    vi.mocked(isFeatureEnabledForEveryone).mockResolvedValue(false);
    vi.mocked(canViewForms).mockResolvedValue(true);
    expect(await canManageFormPlacement("u1", "f1")).toBe(true);
  });

  it("flag on: edit on the form's page, whatever canViewForms says", async () => {
    vi.mocked(isFeatureEnabledForEveryone).mockResolvedValue(true);
    vi.mocked(canViewForms).mockResolvedValue(true);
    (prisma as any).page.findUnique.mockResolvedValue({ id: "f1" });
    vi.mocked(getPageAccess).mockResolvedValue(access(false));
    expect(await canManageFormPlacement("u1", "f1")).toBe(false);
    vi.mocked(getPageAccess).mockResolvedValue(access(true));
    expect(await canManageFormPlacement("u1", "f1")).toBe(true);
  });
});
