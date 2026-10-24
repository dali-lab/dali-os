import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/lib/db", () => ({ prisma: {
  term: { findMany: vi.fn() }, domain: { findMany: vi.fn() },
  partnerApplicationTargetTerm: { findMany: vi.fn() },
} }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), currentTerm: vi.fn() }));
vi.mock("../../components/PartnerTermPlanner", () => ({ PartnerTermPlanner: () => null }));
vi.mock("../../components/PartnerCrmNav", () => ({ PartnerCrmNav: () => null }));
import { prisma } from "~/lib/db";
import { requireAuth, isNonMember } from "~/lib/auth";
import { isCore, currentTerm } from "~/lib/roles";
import { loader } from "../core.partners.plan";
function load(query = "") {
  return loader({ request: new Request(`http://localhost/core/partners/plan${query}`), params: {}, context: {} } as never);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(currentTerm).mockResolvedValue({ id: "current" } as never);
  vi.mocked(prisma.term.findMany).mockResolvedValue([{ id: "next", code: "27W", sortKey: 2 }, { id: "current", code: "26F", sortKey: 1 }] as never);
  vi.mocked(prisma.domain.findMany).mockResolvedValue([]);
  vi.mocked(prisma.partnerApplicationTargetTerm.findMany).mockResolvedValue([]);
});
it.each(["", "?term=", "?term=all", "?term=upcoming", "?term=missing"])("defaults to a real current term for %s", async (query) => {
  expect(await load(query)).toMatchObject({ selectedTermId: "current" });
  expect(prisma.partnerApplicationTargetTerm.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { termId: "current" } }));
});
it("loads exactly the selected term and maps its planning metadata", async () => {
  vi.mocked(prisma.partnerApplicationTargetTerm.findMany).mockResolvedValue([{
    id: "target", planningStatus: "Maybe", plannerNotes: "Note", plannerTodo: "Task",
    application: { id: "app", title: "Project", stage: "New", feeCents: 1200000, partnerOrg: { name: "Org" }, domains: [{ id: "scope", domainId: "dev", expectedMembers: 3 }] },
  }] as never);
  expect(await load("?term=next")).toMatchObject({ selectedTermId: "next", rows: [{
    targetTermId: "target", applicationId: "app", partnerName: "Org", planningStatus: "Maybe", plannerNotes: "Note", plannerTodo: "Task", domains: [{ expectedMembers: 3 }],
  }] });
  expect(prisma.partnerApplicationTargetTerm.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { termId: "next" } }));
});
it("falls back to the latest available term and handles no terms", async () => {
  vi.mocked(currentTerm).mockResolvedValue(null);
  expect(await load()).toMatchObject({ selectedTermId: "next" });
  vi.mocked(prisma.term.findMany).mockResolvedValue([]);
  expect(await load()).toMatchObject({ selectedTermId: null, rows: [], domains: [] });
});
it("redirects unauthorized visitors before loading planning data", async () => {
  vi.mocked(requireAuth).mockResolvedValueOnce({ ok: false } as never);
  expect(await load()).toBeInstanceOf(Response);
  vi.mocked(isNonMember).mockResolvedValueOnce(true);
  expect((await load() as Response).headers.get("Location")).toBe("/portal");
  vi.mocked(isCore).mockResolvedValueOnce(false);
  expect((await load() as Response).headers.get("Location")).toBe("/");
  expect(prisma.partnerApplicationTargetTerm.findMany).not.toHaveBeenCalled();
});
