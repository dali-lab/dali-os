import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/hiring/lib/confidentiality", () => ({
  getCycleConfidentialityState: vi.fn().mockResolvedValue({ status: "none" }),
}));
vi.mock("~/lib/doc-search.server", () => ({ searchPageContent: vi.fn() }));
vi.mock("~/forms/lib/form-access.server", () => ({ formsUsePageAccess: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({
  PAGE_ACCESS_SELECT: { id: true },
  getPageAccessBulk: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { searchPageContent } from "~/lib/doc-search.server";
import { formsUsePageAccess } from "~/forms/lib/form-access.server";
import { getPageAccessBulk } from "~/lib/pageAccess.server";
import { runSearch } from "~/lib/search.server";
import type { UserRoles } from "~/lib/roles";

const m = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const MEMBER: UserRoles = {
  isLabMember: true,
  isCore: false,
  isAdmin: false,
  isDomainLead: false,
  isInstructor: false,
  isInterviewer: false,
  isAlumni: false,
  isStaff: false,
  canViewForms: false,
  canViewStaffing: false,
};

const access = (viewable: string[]) =>
  vi.mocked(getPageAccessBulk).mockImplementation(
    async (_u, pages) => new Map(pages.map((p) => [p.id, { canView: viewable.includes(p.id), canEdit: false, canComment: false }])),
  );

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of ["user", "cycleReviewer", "project", "task", "projectFile", "pageDoc"]) {
    m[model].findMany.mockResolvedValue([]);
  }
  vi.mocked(searchPageContent).mockResolvedValue([]);
  access([]);
  m.page.findMany.mockResolvedValue([]);
  m.form.findMany.mockResolvedValue([]);
});

describe("runSearch forms with forms-page-access on", () => {
  beforeEach(() => vi.mocked(formsUsePageAccess).mockResolvedValue(true));

  it("returns the Form pages the viewer can view, without canViewForms", async () => {
    m.page.findMany.mockImplementation(async (args: any) =>
      args.where.kind === "Form"
        ? [
            { id: "seen", title: "Intake form", iconEmoji: null },
            { id: "hidden", title: "Intake secret", iconEmoji: null },
          ]
        : [],
    );
    access(["seen"]);
    const results = await runSearch({ userId: "u1", roles: MEMBER, q: "intake" });
    const forms = results.filter((r) => r.type === "form");
    expect(forms).toEqual([expect.objectContaining({ id: "seen", title: "Intake form", subtitle: "Form" })]);
    expect(m.form.findMany).not.toHaveBeenCalled();
  });

  it("queries live Form pages by title only", async () => {
    await runSearch({ userId: "u1", roles: MEMBER, q: "intake" });
    const formQuery = m.page.findMany.mock.calls.map((c) => c[0]).find((a: any) => a.where.kind === "Form");
    expect(formQuery.where).toEqual({ kind: "Form", archivedAt: null, title: { contains: "intake", mode: "insensitive" } });
  });

  it("still keeps Form pages out of document results", async () => {
    await runSearch({ userId: "u1", roles: MEMBER, q: "intake" });
    const docQuery = m.page.findMany.mock.calls.map((c) => c[0]).find((a: any) => a.where.kind?.not === "Form");
    expect(docQuery).toBeDefined();
  });
});

describe("runSearch forms with forms-page-access off", () => {
  beforeEach(() => vi.mocked(formsUsePageAccess).mockResolvedValue(false));

  it("keeps the canViewForms gate and the Form table", async () => {
    await runSearch({ userId: "u1", roles: MEMBER, q: "intake" });
    expect(m.form.findMany).not.toHaveBeenCalled();
    await runSearch({ userId: "u1", roles: { ...MEMBER, canViewForms: true }, q: "intake" });
    expect(m.form.findMany).toHaveBeenCalledTimes(1);
    // Only the document pass checks access here, and it had no pages to check.
    expect(vi.mocked(getPageAccessBulk).mock.calls.every(([, pages]) => pages.length === 0)).toBe(true);
  });
});
