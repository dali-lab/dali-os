import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabledForEveryone: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ PAGE_ACCESS_SELECT: { id: true }, getPageAccess: vi.fn() }));
vi.mock("~/lib/roles", () => ({ canViewForms: vi.fn(), isCore: vi.fn(), requireMember: vi.fn() }));
vi.mock("~/lib/groups", () => ({ isUserInAnyGroup: vi.fn() }));

import { prisma } from "~/lib/db";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canViewForms, isCore, requireMember } from "~/lib/roles";
import { canBuildForm, canSeeForm, fillAccessByPage } from "~/forms/lib/form-access.server";
import { formFillAccess } from "~/forms/lib/public-form";

const page = { id: "f1", kind: "Form", archivedAt: null, linkAccess: "Restricted" };
const access = (over: Partial<{ canView: boolean; canEdit: boolean }>) =>
  ({ canView: false, canEdit: false, canComment: false, ...over }) as any;

beforeEach(() => {
  vi.resetAllMocks();
  (prisma as any).page.findUnique.mockResolvedValue(page);
});

describe("flag off: legacy gates", () => {
  beforeEach(() => vi.mocked(isFeatureEnabledForEveryone).mockResolvedValue(false));

  it("canSeeForm is canViewForms", async () => {
    vi.mocked(canViewForms).mockResolvedValue(true);
    expect(await canSeeForm("u1", "f1")).toBe(true);
    expect(getPageAccess).not.toHaveBeenCalled();
  });

  it("canBuildForm is isCore", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect(await canBuildForm("u1", "f1")).toBe(false);
    expect(getPageAccess).not.toHaveBeenCalled();
  });

  it("formFillAccess reads the form's own audience", async () => {
    vi.mocked(requireMember).mockResolvedValue(true as any);
    expect(await formFillAccess({ id: "f1", audience: "Members", audienceGroupIds: [] }, "u1")).toBe("ok");
    expect(await formFillAccess({ id: "f1", audience: "Members", audienceGroupIds: [] }, null)).toBe("login");
    expect(getPageAccess).not.toHaveBeenCalled();
  });
});

describe("flag on: the form's page decides", () => {
  beforeEach(() => vi.mocked(isFeatureEnabledForEveryone).mockResolvedValue(true));

  it("canSeeForm is the page's canView, even for a trashed form", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access({ canView: true }));
    expect(await canSeeForm("u1", "f1")).toBe(true);
    expect(getPageAccess).toHaveBeenCalledWith("u1", page, undefined, { includeArchived: true });
    expect(canViewForms).not.toHaveBeenCalled();
  });

  it("canBuildForm is the page's canEdit", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access({ canView: true, canEdit: false }));
    expect(await canBuildForm("u1", "f1")).toBe(false);
    vi.mocked(getPageAccess).mockResolvedValue(access({ canView: true, canEdit: true }));
    expect(await canBuildForm("u1", "f1")).toBe(true);
    expect(isCore).not.toHaveBeenCalled();
  });

  it("a form with no page is neither visible nor buildable", async () => {
    (prisma as any).page.findUnique.mockResolvedValue(null);
    expect(await canSeeForm("u1", "f1")).toBe(false);
    expect(await canBuildForm("u1", "f1")).toBe(false);
  });

  it("public general access admits anyone, no session needed", async () => {
    (prisma as any).page.findUnique.mockResolvedValue({ ...page, linkAccess: "Public" });
    expect(await fillAccessByPage("f1", null)).toBe("ok");
    expect(getPageAccess).not.toHaveBeenCalled();
  });

  it("anything else needs a session, then canView", async () => {
    expect(await fillAccessByPage("f1", null)).toBe("login");
    vi.mocked(getPageAccess).mockResolvedValue(access({ canView: false }));
    expect(await fillAccessByPage("f1", "u1")).toBe("denied");
    vi.mocked(getPageAccess).mockResolvedValue(access({ canView: true }));
    expect(await fillAccessByPage("f1", "u1")).toBe("ok");
  });

  it("a trashed form cannot be filled", async () => {
    (prisma as any).page.findUnique.mockResolvedValue({ ...page, linkAccess: "Public", archivedAt: new Date() });
    expect(await fillAccessByPage("f1", "u1")).toBe("denied");
  });

  it("formFillAccess ignores the form's own audience", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access({ canView: true }));
    expect(await formFillAccess({ id: "f1", audience: "Groups", audienceGroupIds: ["g9"] }, "u1")).toBe("ok");
    expect(requireMember).not.toHaveBeenCalled();
  });
});
