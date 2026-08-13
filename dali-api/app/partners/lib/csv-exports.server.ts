import { defineCsvExport, type CsvExportContext } from "~/lib/csv-export.server";
import { prisma } from "~/lib/db";
import { canViewStaffing } from "~/lib/roles";
import { OPEN_APPLICATION_STATUSES } from "../lib/partner-application";
import { pitchExcerpt } from "../lib/application-form.server";
import { partnerHasProjectAccess } from "../lib/partner-access";
import { loadPartnerProjectView } from "../lib/partner-project-view.server";
import { requirementsRows } from "~/projects/lib/csv-exports.server";
import type { Question } from "~/types";

// Both Partner tables gate identically to their pages: authenticated,
// non-applicant, canViewStaffing (Core or Admin) — see
// app/partners/routes/partners.tsx / partners.applications.tsx loaders.
async function canViewPartners(ctx: CsvExportContext): Promise<boolean> {
  if (ctx.user.type === "applicant") return false;
  return canViewStaffing(ctx.user.sub);
}

const dateStamp = () => new Date().toISOString().slice(0, 10);

defineCsvExport({
  id: "partners-organizations",
  filename: () => `partner-organizations-${dateStamp()}.csv`,
  authorize: canViewPartners,
  async rows() {
    const now = new Date();
    const orgs = await prisma.partnerOrg.findMany({
      orderBy: { name: "asc" },
      select: {
        name: true,
        website: true,
        isIndividual: true,
        _count: { select: { users: true } },
        projects: { select: { startedAt: true, endedAt: true, project: { select: { status: true } } } },
        applications: { select: { status: true } },
      },
    });

    const out: unknown[][] = [
      ["Organization", "Website", "Individual", "Members", "Active Projects", "Total Projects", "Open Applications"],
    ];
    for (const o of orgs) {
      const activeProjectCount = o.projects.filter(
        (p) =>
          p.project.status !== "Archived" &&
          (p.startedAt === null || p.startedAt <= now) &&
          (p.endedAt === null || p.endedAt > now),
      ).length;
      const openApplicationCount = o.applications.filter((a) =>
        (OPEN_APPLICATION_STATUSES as readonly string[]).includes(a.status),
      ).length;
      out.push([
        o.name,
        o.website ?? "",
        o.isIndividual ? "yes" : "",
        o._count.users,
        activeProjectCount,
        o.projects.length,
        openApplicationCount,
      ]);
    }
    return out;
  },
});

// External partner-portal requirements/stories export (/partner/projects/:id).
// Distinct registration from the internal preview's
// "projects-requirements-internal" (app/projects/lib/csv-exports.server.ts) —
// this one is scoped to the signed-in partner's own org via
// partnerHasProjectAccess, replicating exactly what
// partner.projects.$id.tsx's loader checks before rendering. A partner must
// never be able to pull another partner's project by changing ?projectId=.
defineCsvExport({
  id: "partner-requirements",
  filename: (ctx) => `project-${ctx.searchParams.get("projectId") ?? "unknown"}-requirements-${new Date().toISOString().slice(0, 10)}.csv`,
  authorize: async (ctx) => {
    const projectId = ctx.searchParams.get("projectId");
    if (!projectId) return false;
    return partnerHasProjectAccess(ctx.user.sub, projectId);
  },
  async rows(ctx) {
    const projectId = ctx.searchParams.get("projectId")!;
    const partnerUser = await prisma.partnerUser.findUnique({
      where: { userId: ctx.user.sub },
      select: { partnerOrgId: true },
    });
    const data = await loadPartnerProjectView(projectId, partnerUser?.partnerOrgId ?? null);
    return requirementsRows(data);
  },
});

defineCsvExport({
  id: "partners-applications",
  filename: () => `partner-applications-${dateStamp()}.csv`,
  authorize: canViewPartners,
  async rows(ctx) {
    const statusParam = ctx.searchParams.get("status");
    const domainParam = ctx.searchParams.get("domain");

    const applications = await prisma.partnerApplication.findMany({
      where: statusParam && statusParam !== "all" ? { status: statusParam as never } : {},
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        title: true,
        summary: true,
        status: true,
        partnerOrg: { select: { name: true } },
        formSubmission: {
          select: { answers: true, formVersion: { select: { questions: true } } },
        },
        targetTerms: { orderBy: { term: { sortKey: "asc" } }, select: { term: { select: { code: true } } } },
        domains: {
          select: { domainId: true, expectedMembers: true, domain: { select: { displayName: true } } },
        },
      },
    });

    const filtered =
      domainParam && domainParam !== "all"
        ? applications.filter((a) => a.domains.some((d) => d.domainId === domainParam))
        : applications;

    const out: unknown[][] = [
      ["Title", "Status", "Partner", "Target Terms", "Domains", "Total Expected Members", "Excerpt"],
    ];
    for (const a of filtered) {
      const excerpt = a.formSubmission
        ? pitchExcerpt(
            (a.formSubmission.formVersion.questions as unknown as Question[]) ?? [],
            (a.formSubmission.answers as Record<string, unknown>) ?? {},
          )
        : null;
      out.push([
        a.title,
        a.status,
        a.partnerOrg.name,
        a.targetTerms.map((t) => t.term.code).join("; "),
        a.domains.map((d) => `${d.domain.displayName} (${d.expectedMembers})`).join("; "),
        a.domains.reduce((sum, d) => sum + d.expectedMembers, 0),
        excerpt ?? a.summary ?? "",
      ]);
    }
    return out;
  },
});
