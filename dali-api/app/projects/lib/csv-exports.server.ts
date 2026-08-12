import { defineCsvExport, type CsvExportContext } from "~/lib/csv-export.server";
import { prisma } from "~/lib/db";
import { canViewStaffing, currentTerm } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { ensureStaffingCycle } from "./staffing-cycle";
import { getSlotBinding } from "./form-slots";
import { buildSubmissionView, type SubmissionView } from "./submission-view.server";
import { loadPartnerProjectView } from "~/partners/lib/partner-project-view.server";

const dateStamp = () => new Date().toISOString().slice(0, 10);

// ─── Projects hub list — mirrors projects.hub.tsx loader. No isCore/staffing ─
// gate: any authenticated non-applicant can view/export it, same as the page.

defineCsvExport({
  id: "projects-hub",
  filename: () => `projects-${dateStamp()}.csv`,
  authorize: async (ctx) => ctx.user.type !== "applicant",
  async rows(ctx) {
    const { termId, isAll } = await resolveTermFilter(ctx.request);
    const projects = await prisma.project.findMany({
      where: isAll || !termId ? undefined : { projectTerms: { some: { termId } } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        name: true,
        status: true,
        projectTerms: { select: { term: { select: { code: true, sortKey: true } } } },
        partners: { select: { partnerOrg: { select: { name: true } } } },
        showcase: { select: { status: true } },
      },
    });

    const out: unknown[][] = [["Project", "Status", "First Term", "Partners", "Showcase Status"]];
    for (const p of projects) {
      const startTerm = p.projectTerms.map((pt) => pt.term).sort((a, b) => a.sortKey - b.sortKey)[0];
      out.push([
        p.name,
        p.status,
        startTerm?.code ?? "",
        p.partners.map((pp) => pp.partnerOrg.name).join("; "),
        p.showcase?.status ?? "",
      ]);
    }
    return out;
  },
});

// ─── Staffing submission-board exports (Intent to Work / Project Bids / ─────
// Level Up) — all three are the same dynamic-column shape driven by
// buildSubmissionView, and all three gate their page on canViewStaffing.
// Shared here so the cycle-resolution logic (mirrors each loader's own
// isAll/cycleIds block) isn't triplicated.

async function resolveSubmissionCycles(
  ctx: CsvExportContext,
  slot: "intent-to-work" | "project-bids" | "level-up",
): Promise<{ cycleIds: string[]; formId: string | null } | null> {
  const { terms: termOptions, termId: filterTermId, isAll } = await resolveTermFilter(ctx.request);
  const fallbackTerm = await currentTerm();
  if (!fallbackTerm && termOptions.length === 0) return null;

  let cycleIds: string[];
  let singleCycleId: string | null;
  if (isAll) {
    const cycles = await prisma.staffingCycle.findMany({ select: { id: true } });
    cycleIds = cycles.map((c) => c.id);
    singleCycleId = null;
  } else {
    const t =
      termOptions.find((o) => o.id === filterTermId) ??
      (fallbackTerm ? { id: fallbackTerm.id, code: fallbackTerm.code } : termOptions[0]);
    const cycle = await ensureStaffingCycle(t.id, t.code);
    cycleIds = [cycle.id];
    singleCycleId = cycle.id;
  }

  const binding = singleCycleId ? await getSlotBinding(singleCycleId, slot) : null;
  return { cycleIds, formId: binding?.formId ?? null };
}

function submissionRows(view: SubmissionView): unknown[][] {
  const out: unknown[][] = [["Name", "Email", ...view.tableColumns.map((c) => c.label)]];
  for (const r of view.rows) {
    out.push([r.name, r.email ?? "", ...view.tableColumns.map((c) => r.cells[c.key] ?? "")]);
  }
  return out;
}

async function canViewStaffingCtx(ctx: CsvExportContext): Promise<boolean> {
  if (ctx.user.type === "applicant") return false;
  return canViewStaffing(ctx.user.sub);
}

for (const slot of ["intent-to-work", "project-bids", "level-up"] as const) {
  defineCsvExport({
    id: slot,
    filename: () => `${slot}-${dateStamp()}.csv`,
    authorize: canViewStaffingCtx,
    async rows(ctx) {
      const resolved = await resolveSubmissionCycles(ctx, slot);
      if (!resolved) return [["Name", "Email"]];
      const view = await buildSubmissionView({
        cycleIds: resolved.cycleIds,
        slot,
        formId: resolved.formId,
      });
      return submissionRows(view);
    },
  });
}

// ─── Requirements/Stories — internal preview only ───────────────────────────
// (/projects/:id/partner-view). This route is deliberately open to any
// signed-in non-applicant member (see that loader's own comment: not scoped
// to the project team or Core) — the export replicates that exact policy,
// not a stricter one. The EXTERNAL partner-portal version of this same view
// (/partner/projects/:id) is registered separately in
// app/partners/lib/csv-exports.server.ts under a different export id, scoped
// to the signed-in partner's own org via partnerHasProjectAccess — the two
// must stay separate registrations because their authorization models
// genuinely differ.

defineCsvExport({
  id: "projects-requirements-internal",
  filename: (ctx) => `project-${ctx.searchParams.get("projectId") ?? "unknown"}-requirements-${dateStamp()}.csv`,
  authorize: async (ctx) => ctx.user.type !== "applicant",
  async rows(ctx) {
    const projectId = ctx.searchParams.get("projectId");
    if (!projectId) return [["Epic", "Story", "Status", "Priority", "Category", "Success Metric", "Acceptance Criteria"]];
    const data = await loadPartnerProjectView(projectId, null);
    return requirementsRows(data);
  },
});

export function requirementsRows(
  data: Awaited<ReturnType<typeof loadPartnerProjectView>>,
): unknown[][] {
  const out: unknown[][] = [
    ["Epic", "Story", "Status", "Priority", "Category", "Success Metric", "Acceptance Criteria"],
  ];
  if (!data) return out;
  for (const epic of data.epics) {
    for (const story of epic.stories) {
      out.push([
        epic.title,
        story.title,
        story.status,
        story.priority ?? "",
        story.category ?? "",
        story.successMetric ?? "",
        story.acceptanceCriteria ?? "",
      ]);
    }
  }
  return out;
}
