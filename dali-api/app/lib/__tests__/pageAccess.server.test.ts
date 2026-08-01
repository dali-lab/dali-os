import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    page: { findUnique: vi.fn() },
    instructorAssignment: { findFirst: vi.fn() },
  },
}));

vi.mock("~/lib/roles", () => ({
  isCore: vi.fn().mockResolvedValue(false),
  isProjectMember: vi.fn().mockResolvedValue(false),
  isLabMember: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/partners/lib/partner-access", () => ({
  partnerHasProjectAccess: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/members/lib/personal-notes.server", () => ({
  noteAccess: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { isCore, isProjectMember, isLabMember } from "~/lib/roles";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { noteAccess } from "~/members/lib/personal-notes.server";
import { getPageAccess } from "../pageAccess.server";

const mockPrisma = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(false);
  vi.mocked(isLabMember).mockResolvedValue(false);
  vi.mocked(partnerHasProjectAccess).mockResolvedValue(false);
});

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-1",
    workspaceType: "Lab",
    workspaceId: null,
    archivedAt: null,
    partnerVisible: false,
    createdById: null,
    ...overrides,
  };
}

function denied() {
  return { canView: false, canEdit: false, canComment: false, canResolve: false };
}

// ── Archived pages ──────────────────────────────────────────────────────────
describe("archived pages", () => {
  it("denies all access to archived pages regardless of role", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const result = await getPageAccess("core-user", page({ archivedAt: new Date() }));
    expect(result).toEqual(denied());
  });
});

// ── Member-workspace (personal notes) ───────────────────────────────────────
describe("Member workspace", () => {
  it("denies when workspaceId is null", async () => {
    const result = await getPageAccess(
      "u1",
      page({ workspaceType: "Member", workspaceId: null }),
    );
    expect(result).toEqual(denied());
  });

  it("denies when noteAccess throws", async () => {
    vi.mocked(noteAccess).mockRejectedValue(new Error("not found"));
    const result = await getPageAccess(
      "u1",
      page({ workspaceType: "Member", workspaceId: "owner-1" }),
    );
    expect(result).toEqual(denied());
  });

  it("grants view+comment (no edit) to shared non-owner", async () => {
    vi.mocked(noteAccess).mockResolvedValue({ canView: true, canEdit: false, isOwner: false });
    vi.mocked(isCore).mockResolvedValue(false);
    const result = await getPageAccess(
      "viewer",
      page({ workspaceType: "Member", workspaceId: "owner-1" }),
    );
    expect(result.canView).toBe(true);
    expect(result.canEdit).toBe(false);
    expect(result.canComment).toBe(true);
    expect(result.canResolve).toBe(false);
  });

  it("grants full access to the owner", async () => {
    vi.mocked(noteAccess).mockResolvedValue({ canView: true, canEdit: true, isOwner: true });
    const result = await getPageAccess(
      "owner-1",
      page({ workspaceType: "Member", workspaceId: "owner-1" }),
    );
    expect(result.canView).toBe(true);
    expect(result.canEdit).toBe(true);
    expect(result.canComment).toBe(true);
    expect(result.canResolve).toBe(true);
  });

  it("Core gets no bypass — denied if noteAccess denies", async () => {
    vi.mocked(noteAccess).mockResolvedValue({ canView: false, canEdit: false, isOwner: false });
    vi.mocked(isCore).mockResolvedValue(true);
    const result = await getPageAccess(
      "core-user",
      page({ workspaceType: "Member", workspaceId: "owner-1" }),
    );
    expect(result).toEqual(denied());
  });
});

// ── Lab workspace ────────────────────────────────────────────────────────────
describe("Lab workspace", () => {
  it("allows any lab member full access", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    const result = await getPageAccess("lab-member", page({ workspaceType: "Lab" }));
    expect(result).toEqual({ canView: true, canEdit: true, canComment: true, canResolve: true });
  });

  it("denies non-members", async () => {
    const result = await getPageAccess("stranger", page({ workspaceType: "Lab" }));
    expect(result).toEqual(denied());
  });

  it("Core has full access (Core ⊇ lab member)", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const result = await getPageAccess("core-user", page({ workspaceType: "Lab" }));
    expect(result).toEqual({ canView: true, canEdit: true, canComment: true, canResolve: true });
  });
});

// ── Project workspace ────────────────────────────────────────────────────────
describe("Project workspace", () => {
  const projectPage = (over: Record<string, unknown> = {}) =>
    page({ workspaceType: "Project", workspaceId: "proj-1", ...over });

  it("allows Core full access", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const result = await getPageAccess("core-user", projectPage());
    expect(result).toEqual({ canView: true, canEdit: true, canComment: true, canResolve: true });
  });

  it("allows project member full access", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(true);
    const result = await getPageAccess("member", projectPage());
    expect(result).toEqual({ canView: true, canEdit: true, canComment: true, canResolve: true });
    expect(isProjectMember).toHaveBeenCalledWith("member", "proj-1");
  });

  it("denies non-member on non-partner-visible page", async () => {
    vi.mocked(partnerHasProjectAccess).mockResolvedValue(true);
    const result = await getPageAccess("partner-user", projectPage({ partnerVisible: false }));
    expect(result).toEqual(denied());
    expect(partnerHasProjectAccess).not.toHaveBeenCalled();
  });

  it("grants view+comment (no edit, no resolve) to partner on partner-visible page", async () => {
    vi.mocked(partnerHasProjectAccess).mockResolvedValue(true);
    const result = await getPageAccess("partner-user", projectPage({ partnerVisible: true }));
    expect(result.canView).toBe(true);
    expect(result.canEdit).toBe(false);
    expect(result.canComment).toBe(true);
    expect(result.canResolve).toBe(false);
  });

  it("denies partner without project access even on partner-visible page", async () => {
    vi.mocked(partnerHasProjectAccess).mockResolvedValue(false);
    const result = await getPageAccess("partner-user", projectPage({ partnerVisible: true }));
    expect(result).toEqual(denied());
  });

  it("grants view+comment (no edit, no resolve) to non-member lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    const result = await getPageAccess("lab-member", projectPage());
    expect(result.canView).toBe(true);
    expect(result.canEdit).toBe(false);
    expect(result.canComment).toBe(true);
    expect(result.canResolve).toBe(false);
  });

  it("denies stranger (non-lab-member)", async () => {
    const result = await getPageAccess("stranger", projectPage());
    expect(result).toEqual(denied());
  });
});

// ── EducationOffering workspace ──────────────────────────────────────────────
describe("EducationOffering workspace", () => {
  const eduPage = (over: Record<string, unknown> = {}) =>
    page({ workspaceType: "EducationOffering", workspaceId: "offering-1", ...over });

  beforeEach(() => {
    mockPrisma.instructorAssignment = { findFirst: vi.fn().mockResolvedValue(null) };
  });

  it("allows Core full access", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    const result = await getPageAccess("core-user", eduPage());
    expect(result).toEqual({ canView: true, canEdit: true, canComment: true, canResolve: true });
  });

  it("allows instructor full access", async () => {
    mockPrisma.instructorAssignment.findFirst.mockResolvedValue({ id: "ia-1" });
    const result = await getPageAccess("instructor", eduPage());
    expect(result).toEqual({ canView: true, canEdit: true, canComment: true, canResolve: true });
  });

  it("grants view+comment (no edit) to non-instructor lab member", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    const result = await getPageAccess("lab-member", eduPage());
    expect(result.canView).toBe(true);
    expect(result.canEdit).toBe(false);
    expect(result.canComment).toBe(true);
    expect(result.canResolve).toBe(false);
  });

  it("denies complete stranger", async () => {
    const result = await getPageAccess("stranger", eduPage());
    expect(result).toEqual(denied());
  });
});

// ── pageId overload (fetches page) ──────────────────────────────────────────
describe("pageId string overload", () => {
  it("returns denied if page not found", async () => {
    mockPrisma.page.findUnique.mockResolvedValue(null);
    const result = await getPageAccess("u1", "missing-page");
    expect(result).toEqual(denied());
    expect(mockPrisma.page.findUnique).toHaveBeenCalledWith({
      where: { id: "missing-page" },
      select: expect.objectContaining({ id: true, workspaceType: true }),
    });
  });

  it("fetches the page and computes access", async () => {
    vi.mocked(isLabMember).mockResolvedValue(true);
    mockPrisma.page.findUnique.mockResolvedValue({
      id: "p1",
      workspaceType: "Lab",
      workspaceId: null,
      archivedAt: null,
      partnerVisible: false,
      createdById: null,
    });
    const result = await getPageAccess("lab-member", "p1");
    expect(result).toEqual({ canView: true, canEdit: true, canComment: true, canResolve: true });
  });
});
