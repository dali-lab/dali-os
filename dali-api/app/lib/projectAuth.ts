import { prisma } from "~/lib/db";
import { currentTerm, isAdmin, isCore } from "~/lib/roles";

// Permission helpers for the Projects workspace. Builds on lib/roles.ts —
// adds project-scoped checks (member-of-this-project, PM-of-this-project)
// while reusing tier-level checks (Core, Admin) from there.

export interface ProjectMembership {
  /** True if the user has a current-term ProjectAssignment on this project. */
  isMember: boolean;
  /** True if the user has a current-term PM ProjectAssignment on this project. */
  isPM: boolean;
  /** True if the user is Core for the current term (broad access). */
  isCore: boolean;
  /** True if the user is Admin (superset of Core). */
  isAdmin: boolean;
  /** True if any of (isMember, isPM, isCore, isAdmin) — can view + edit non-Settings surfaces. */
  canEdit: boolean;
  /** True if the user can change project-wide Settings (rename, calendarEmail, role requests, partners). */
  canEditSettings: boolean;
  /** True if the user can archive or pause the project (Core / Admin only). */
  canArchive: boolean;
}

/** PM domain code used for `ProjectAssignment.domain.code` lookups. */
const PM_DOMAIN_CODE = "PM";

/**
 * Resolve a user's membership shape against a project. The `termId` argument
 * is optional — if omitted, the current term is resolved via `currentTerm()`.
 * On boundary days (no current term), only Core/Admin gates pass.
 */
export async function getProjectMembership(
  userId: string,
  projectId: string,
  termId?: string | null,
): Promise<ProjectMembership> {
  const term = termId
    ? await prisma.term.findUnique({ where: { id: termId }, select: { id: true } })
    : await currentTerm();

  const [admin, core, assignments] = await Promise.all([
    isAdmin(userId),
    isCore(userId),
    term
      ? prisma.projectAssignment.findMany({
          where: { userId, projectId, termId: term.id },
          select: { domain: { select: { code: true } } },
        })
      : Promise.resolve([] as { domain: { code: string } }[]),
  ]);

  const isMember = assignments.length > 0;
  const isPM = assignments.some((a) => a.domain.code === PM_DOMAIN_CODE);

  const canEdit = isMember || isPM || core || admin;
  const canEditSettings = isPM || core || admin;
  const canArchive = core || admin;

  return {
    isMember,
    isPM,
    isCore: core,
    isAdmin: admin,
    canEdit,
    canEditSettings,
    canArchive,
  };
}

/**
 * Hard gate for project-member-or-Core-or-Admin. Returns the membership shape
 * on success; throws a Response(403) on failure. Use in actions and protected
 * loaders that should be unreachable otherwise.
 */
export async function requireProjectEditor(
  userId: string,
  projectId: string,
  termId?: string | null,
): Promise<ProjectMembership> {
  const m = await getProjectMembership(userId, projectId, termId);
  if (!m.canEdit) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return m;
}

export async function requireProjectSettingsEditor(
  userId: string,
  projectId: string,
  termId?: string | null,
): Promise<ProjectMembership> {
  const m = await getProjectMembership(userId, projectId, termId);
  if (!m.canEditSettings) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return m;
}

export async function requireProjectArchiver(
  userId: string,
  projectId: string,
): Promise<ProjectMembership> {
  const m = await getProjectMembership(userId, projectId, null);
  if (!m.canArchive) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return m;
}

/** True if the user can create a new Project (Core / Admin). */
export async function canCreateProject(userId: string): Promise<boolean> {
  if (await isAdmin(userId)) return true;
  return isCore(userId);
}

export async function requireProjectCreator(userId: string): Promise<void> {
  if (!(await canCreateProject(userId))) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
}
