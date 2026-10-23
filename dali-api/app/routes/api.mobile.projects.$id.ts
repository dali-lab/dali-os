import type { Route } from "./+types/api.mobile.projects.$id";
import { prisma } from "~/lib/db";
import { currentTerm, isCore, isProjectMember } from "~/lib/roles";
import { currentSprintBand } from "~/projects/lib/task-board";
import { DAY } from "~/projects/lib/timeline-days";
import { listMemberSummaries, termFactsForUser } from "~/lib/mobile-members.server";
import { boardCounts, githubRef, leadLabels, sprintNumberFromLabel } from "~/lib/mobile-format";
import { mobileError, mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const guard = await requireMobileUser(request);
  if (!guard.ok) return guard.response;
  const { userId } = guard;
  const projectId = params.id;

  const [core, member] = await Promise.all([isCore(userId, request), isProjectMember(userId, projectId)]);
  if (!core && !member) return mobileError("Not found", 404);

  const term = await currentTerm(request);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      status: true,
      projectTerms: {
        select: { term: { select: { code: true, startDate: true, endDate: true, sortKey: true } } },
      },
      domains: { select: { domain: { select: { displayName: true } } } },
      assignments: {
        select: { userId: true, termId: true, domain: { select: { displayName: true } } },
      },
      epics: {
        orderBy: { position: "asc" },
        select: { id: true, title: true, startsAt: true, endsAt: true },
      },
      tasks: {
        where: { archivedAt: null },
        orderBy: [{ status: "asc" }, { position: "asc" }],
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          startsAt: true,
          dueAt: true,
          epicId: true,
          githubIssueNumber: true,
          domain: { select: { displayName: true } },
          assignees: { select: { userId: true } },
          _count: { select: { comments: true, files: true } },
        },
      },
    },
  });
  if (!project) return mobileError("Not found", 404);

  const termSpans = project.projectTerms
    .map((pt) => pt.term)
    .sort((a, b) => a.sortKey - b.sortKey);
  const band = currentSprintBand(
    termSpans.map((t) => ({ code: t.code, startsAt: t.startDate.toISOString(), endsAt: t.endDate.toISOString() })),
    new Date(),
  );
  const sprintNumber = band ? sprintNumberFromLabel(band.label) : null;

  const currentAssignments = term ? project.assignments.filter((a) => a.termId === term.id) : [];
  const staffing = currentAssignments.length > 0 ? currentAssignments : project.assignments;
  const memberIds = [...new Set(staffing.map((a) => a.userId))];
  const mine = currentAssignments.find((a) => a.userId === userId);

  const taskUserIds = project.tasks.flatMap((t) => t.assignees.map((a) => a.userId));
  const [members, facts] = await Promise.all([
    listMemberSummaries([...memberIds, ...taskUserIds]),
    termFactsForUser(userId, term?.code ?? null),
  ]);

  const roles = project.domains.length
    ? project.domains.map((d) => d.domain.displayName)
    : [...new Set(staffing.map((a) => a.domain.displayName))];

  return mobileJson({
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      terms: termSpans.map((t) => t.code),
      myRole: mine?.domain.displayName ?? null,
      myLeadRole: facts ? leadLabels(facts)[0] ?? null : null,
      roles,
      memberIds,
      sprint:
        band && sprintNumber != null
          ? {
              number: sprintNumber,
              startDate: new Date(band.key).toISOString(),
              endDate: new Date(band.end + DAY - 1).toISOString(),
            }
          : null,
      ...boardCounts(project.tasks.map((t) => t.status)),
    },
    members,
    epics: project.epics.map((e) => ({
      id: e.id,
      name: e.title,
      startDate: e.startsAt?.toISOString() ?? null,
      endDate: e.endsAt?.toISOString() ?? null,
    })),
    tasks: project.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      assigneeIds: t.assignees.map((a) => a.userId),
      startDate: t.startsAt?.toISOString() ?? null,
      dueDate: t.dueAt?.toISOString() ?? null,
      role: t.domain?.displayName ?? null,
      epicId: t.epicId,
      commentCount: t._count.comments,
      attachmentCount: t._count.files,
      linkRef: githubRef(t.githubIssueNumber),
    })),
  });
}
