import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/pageAccess.server", () => ({ PAGE_ACCESS_SELECT: { id: true }, getPageAccess: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isLabMember: vi.fn() }));

import { prisma } from "~/lib/db";
import { getPageAccess } from "~/lib/pageAccess.server";
import { canBuildForm, canSeeForm, fillAccessByPage } from "~/forms/lib/form-access.server";
import { formFillAccess } from "~/forms/lib/public-form";

const page = { id: "f1", kind: "Form", archivedAt: null, linkAccess: "Restricted" };
const access = (over: Partial<{ canView: boolean; canEdit: boolean }>) =>
  ({ canView: false, canEdit: false, canComment: false, ...over }) as any;

beforeEach(() => {
  vi.resetAllMocks();
  (prisma as any).page.findUnique.mockResolvedValue(page);
});

describe("the form's page decides", () => {
  it("canSeeForm is the page's canView, even for a trashed form", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access({ canView: true }));
    expect(await canSeeForm("u1", "f1")).toBe(true);
    expect(getPageAccess).toHaveBeenCalledWith("u1", page, undefined, { includeArchived: true });
  });

  it("canBuildForm is the page's canEdit", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access({ canView: true, canEdit: false }));
    expect(await canBuildForm("u1", "f1")).toBe(false);
    vi.mocked(getPageAccess).mockResolvedValue(access({ canView: true, canEdit: true }));
    expect(await canBuildForm("u1", "f1")).toBe(true);
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

  it("formFillAccess delegates to the page: Public admits without a session", async () => {
    (prisma as any).page.findUnique.mockResolvedValue({ ...page, linkAccess: "Public" });
    expect(await formFillAccess({ id: "f1" }, null)).toBe("ok");
    expect(getPageAccess).not.toHaveBeenCalled();
  });

  it("formFillAccess sends a sessionless visitor of a non-Public page to login", async () => {
    expect(await formFillAccess({ id: "f1" }, null)).toBe("login");
  });

  it("formFillAccess follows the page's canView for a signed-in viewer", async () => {
    vi.mocked(getPageAccess).mockResolvedValue(access({ canView: true }));
    expect(await formFillAccess({ id: "f1" }, "u1")).toBe("ok");
    vi.mocked(getPageAccess).mockResolvedValue(access({ canView: false }));
    expect(await formFillAccess({ id: "f1" }, "u1")).toBe("denied");
  });

  it("formFillAccess denies a missing or trashed page", async () => {
    (prisma as any).page.findUnique.mockResolvedValue(null);
    expect(await formFillAccess({ id: "f1" }, "u1")).toBe("denied");
    (prisma as any).page.findUnique.mockResolvedValue({ ...page, archivedAt: new Date() });
    expect(await formFillAccess({ id: "f1" }, "u1")).toBe("denied");
  });
});
