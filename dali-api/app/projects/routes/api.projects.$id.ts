import type { Route } from "./+types/api.projects.$id";
import { prisma } from "~/lib/db";
import { requireCore } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

// DELETE /api/projects/:id — permanently delete a project. Admin/Core only.
//
// Guardrailed rather than cascading. Most models that reference a project use
// the default restrict rule, and four (StaffingPreference, EssentialityForm,
// StaffingAssignment, MentorNote) carry a projectId with no foreign key at all,
// so a blind delete would either fail on a constraint or silently orphan rows.
// Worse, TimeEntry (payroll) and BudgetEntry/BudgetNote (finance) hang off a
// project — records that must not disappear because someone tidied up a
// project page.
//
// So: a project is deletable only while it is still empty. Anything with real
// history is refused with a breakdown of what is holding it, and Archive
// remains the way to retire a project that has one.

/**
 * Everything that makes a project non-empty. Order is the order shown to the
 * user, so keep the payroll/finance entries first — they're the ones where
 * "why can't I delete this" most needs an obvious answer.
 */
const BLOCKERS: { label: string; count: (projectId: string) => Promise<number> }[] = [
  { label: "time entries", count: (projectId) => prisma.timeEntry.count({ where: { projectId } }) },
  { label: "budget entries", count: (projectId) => prisma.budgetEntry.count({ where: { projectId } }) },
  { label: "budget notes", count: (projectId) => prisma.budgetNote.count({ where: { projectId } }) },
  { label: "staffing assignments", count: (projectId) => prisma.projectAssignment.count({ where: { projectId } }) },
  { label: "epics", count: (projectId) => prisma.epic.count({ where: { projectId } }) },
  { label: "sprints", count: (projectId) => prisma.sprint.count({ where: { projectId } }) },
  { label: "tasks", count: (projectId) => prisma.task.count({ where: { projectId } }) },
  { label: "scheduled meetings", count: (projectId) => prisma.scheduledMeeting.count({ where: { projectId } }) },
  { label: "mentorship pairs", count: (projectId) => prisma.mentorshipPair.count({ where: { projectId } }) },
  { label: "external mentors", count: (projectId) => prisma.externalMentor.count({ where: { projectId } }) },
  { label: "per-term statuses", count: (projectId) => prisma.projectTermStatus.count({ where: { projectId } }) },
  { label: "role requests", count: (projectId) => prisma.projectRoleRequest.count({ where: { projectId } }) },
  { label: "linked partners", count: (projectId) => prisma.projectPartner.count({ where: { projectId } }) },
  // No FK to Project — these would orphan rather than block, so check them too.
  { label: "staffing preferences", count: (projectId) => prisma.staffingPreference.count({ where: { projectId } }) },
  { label: "essentiality forms", count: (projectId) => prisma.essentialityForm.count({ where: { projectId } }) },
  { label: "staffing-cycle assignments", count: (projectId) => prisma.staffingAssignment.count({ where: { projectId } }) },
  { label: "mentor notes", count: (projectId) => prisma.mentorNote.count({ where: { projectId } }) },
];

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const gate = await requireCore(request);
  if (!gate.ok) return gate.response;

  const projectId = params.id!;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, overviewPageId: true, prdPageId: true },
  });
  if (!project) {
    return withCors(request, Response.json({ error: "Project not found" }, { status: 404 }));
  }

  const counts = await Promise.all(BLOCKERS.map((b) => b.count(projectId)));
  const blocking = BLOCKERS.map((b, i) => ({ label: b.label, count: counts[i]! })).filter(
    (b) => b.count > 0,
  );

  if (blocking.length > 0) {
    return withCors(
      request,
      Response.json(
        {
          error: "This project still has data attached, so it can't be deleted.",
          blocking,
        },
        { status: 409 },
      ),
    );
  }

  // Only ProjectFile, ProjectDomain, ProjectTerm and ProjectDomainScope cascade;
  // all four are empty-safe. The overview/PRD pages are referenced *from* the
  // project, so clear those references before removing the row.
  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: { overviewPageId: null, prdPageId: null },
    });
    await tx.project.delete({ where: { id: projectId } });
  });

  return withCors(request, Response.json({ ok: true, name: project.name }));
}
