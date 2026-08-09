import type { Route } from "./+types/api.projects.$id";
import { prisma } from "~/lib/db";
import { requireCore } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { pageDocName } from "~/collab/roomName";

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

  // Pages live in the Project workspace via the polymorphic `workspaceId`, which
  // has no foreign key — so they neither block the delete nor cascade, and would
  // simply be orphaned. Every project auto-creates an Overview page (and
  // sometimes a PRD), so those two can't count as content or nothing would ever
  // be deletable; they're removed alongside the project below. Any *other* page
  // is someone's writing and blocks.
  const systemPageIds = [project.overviewPageId, project.prdPageId].filter(
    (id): id is string => id !== null,
  );
  // The "Team meeting notes" / "Partner meeting notes" folders (see
  // ensureMeetingNotesFolder in ~/lib/pages.ts) are backfilled on every project
  // page view and can't be archived (api.documents.$id.ts refuses systemKey
  // pages), so without this they'd count as permanent, un-clearable "documents"
  // and block deletion forever. They're empty Folder-kind containers, not
  // authored content, so exclude and clean them up the same way as overview/PRD.
  const meetingNotesFolders = await prisma.page.findMany({
    where: {
      workspaceType: "Project",
      workspaceId: projectId,
      kind: "Folder",
      systemKey: { not: null },
    },
    select: { id: true, contentDocId: true },
  });
  const excludedPageIds = [...systemPageIds, ...meetingNotesFolders.map((p) => p.id)];
  const authoredPages = await prisma.page.count({
    where: {
      workspaceType: "Project",
      workspaceId: projectId,
      id: { notIn: excludedPageIds },
      archivedAt: null,
    },
  });

  const counts = await Promise.all(BLOCKERS.map((b) => b.count(projectId)));
  const blocking = [
    ...BLOCKERS.map((b, i) => ({ label: b.label, count: counts[i]! })),
    { label: "documents", count: authoredPages },
  ].filter((b) => b.count > 0);

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
  // all four are empty-safe at this point.
  const systemPages = await prisma.page.findMany({
    where: { id: { in: systemPageIds } },
    select: { id: true, contentDocId: true },
  });
  // A FreeForm page's body lives in a CollabDocument keyed by name — the
  // pageDocName() shape unless the page overrides it. Versions cascade off it.
  // Folders (the meeting-notes pages) never have content, but computing a name
  // for them anyway is harmless — deleteMany below just matches nothing.
  const docNames = [...systemPages, ...meetingNotesFolders].map(
    (p) => p.contentDocId ?? pageDocName(p.id),
  );

  await prisma.$transaction(async (tx) => {
    // Project references its own overview/PRD pages, so drop those references
    // before either row can go.
    await tx.project.update({
      where: { id: projectId },
      data: { overviewPageId: null, prdPageId: null },
    });
    await tx.project.delete({ where: { id: projectId } });
    if (excludedPageIds.length) {
      await tx.page.deleteMany({ where: { id: { in: excludedPageIds } } });
    }
    if (docNames.length) {
      await tx.collabDocument.deleteMany({ where: { name: { in: docNames } } });
    }
  });

  await logAuditEvent({
    action: "project.delete",
    userId: gate.auth.user.sub,
    targetId: projectId,
    metadata: { name: project.name, systemPagesDeleted: excludedPageIds.length },
    request,
  });

  return withCors(request, Response.json({ ok: true, name: project.name }));
}
