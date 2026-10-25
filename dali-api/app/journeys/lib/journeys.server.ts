import type { OnboardingJourneyRole } from "~/generated/prisma/enums";
import { prisma, Prisma } from "~/lib/db";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { fullName, primaryEmail } from "~/lib/display";
import { resolvePhotoUrl } from "~/lib/photo";
import { ACTIVE_LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { createJourneyContent } from "./journey-edit";
import { activityKey, getModule, getModuleStatus, hasLab, progressKeys } from "./journey";
import { labApproved } from "./studio.server";
import { validateJourney } from "./journey-validation";
import { parseJourneyContent } from "./content-schema";
import type { Journey, JourneyContent, JourneyDomain, JourneyRole } from "./types";

export interface JourneyViewer {
  id: string;
  isCore: boolean;
  /** Domains the viewer leads; leads can start journeys there. */
  leadDomainIds: string[];
}

export type JourneyResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string) => ({ ok: false as const, status, error });

export async function requireJourneyViewer(request: Request): Promise<JourneyViewer> {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) throw portalRedirect;
  const viewer = await resolveJourneyViewer(auth.user.sub, request);
  if (!viewer) throw new Response("Not found", { status: 404 });
  return viewer;
}

/** The viewer for a signed-in user, or null when journeys are off for them or they aren't a lab member. */
export async function resolveJourneyViewer(userId: string, request?: Request): Promise<JourneyViewer | null> {
  const roles = await getUserRoles(userId, request);
  if (!roles.isLabMember) return null;
  if (!(await isFeatureEnabled("onboarding-journeys", userId, roles, request))) return null;
  const leads = roles.isDomainLead
    ? await prisma.domainLeadAssignment.findMany({
        where: { userId },
        select: { domainId: true },
        distinct: ["domainId"],
      })
    : [];
  return { id: userId, isCore: roles.isCore, leadDomainIds: leads.map((l) => l.domainId) };
}

export function canCreateIn(viewer: JourneyViewer, domainId: string): boolean {
  return viewer.isCore || viewer.leadDomainIds.includes(domainId);
}

const ROLE_FROM_DB: Record<OnboardingJourneyRole, JourneyRole> = { Owner: "owner", Editor: "editor" };
const ROLE_TO_DB: Record<JourneyRole, OnboardingJourneyRole> = { owner: "Owner", editor: "Editor" };

/** A collaborator's role, or owner for Core (who manage every journey), or null. */
export function roleOn(viewer: JourneyViewer, collaborators: { userId: string; role: OnboardingJourneyRole }[]): JourneyRole | null {
  const mine = collaborators.find((c) => c.userId === viewer.id);
  if (mine) return ROLE_FROM_DB[mine.role];
  return viewer.isCore ? "owner" : null;
}

export function toDomain(d: { code: string; displayName: string }): JourneyDomain {
  return { slug: d.code.toLowerCase(), name: d.displayName };
}

const content = (json: Prisma.JsonValue): JourneyContent => json as unknown as JourneyContent;
// Through JSON so optional fields left undefined drop out; Prisma rejects undefined inside Json.
const asJson = (c: JourneyContent) => JSON.parse(JSON.stringify(c)) as Prisma.InputJsonValue;
const version = (d: Date) => d.toISOString();

const DOMAIN_SELECT = { id: true, code: true, displayName: true } as const;

async function journeyDomains() {
  return prisma.domain.findMany({
    where: { active: true, isSystem: false },
    select: DOMAIN_SELECT,
    orderBy: { displayName: "asc" },
  });
}

/** The viewer's own domains, most recent staffing first. */
async function viewerDomainIds(userId: string): Promise<string[]> {
  const [assignments, eligibilities] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { userId },
      select: { domainId: true },
      orderBy: { term: { sortKey: "desc" } },
    }),
    prisma.domainEligibility.findMany({ where: { userId }, select: { domainId: true } }),
  ]);
  return [...new Set([...assignments, ...eligibilities].map((r) => r.domainId))];
}

/** Journeys a viewer may see at all: published ones, plus drafts they can edit. */
function visibleJourneyWhere(viewer: JourneyViewer): Prisma.OnboardingJourneyWhereInput {
  if (viewer.isCore) return {};
  return { OR: [{ published: { not: Prisma.DbNull } }, { collaborators: { some: { userId: viewer.id } } }] };
}

export async function loadJourneyTabs(viewer: JourneyViewer) {
  const [domains, withJourneys, mine] = await Promise.all([
    journeyDomains(),
    prisma.onboardingJourney.findMany({
      where: visibleJourneyWhere(viewer),
      select: { domainId: true },
      distinct: ["domainId"],
    }),
    viewerDomainIds(viewer.id),
  ]);
  const shown = new Set([...withJourneys.map((j) => j.domainId), ...mine]);
  const tabs = domains.filter((d) => shown.has(d.id) || canCreateIn(viewer, d.id));
  const own = mine.map((id) => tabs.find((d) => d.id === id)).find(Boolean);
  const fallback = tabs.find((d) => withJourneys.some((j) => j.domainId === d.id)) ?? tabs[0];
  return { tabs, defaultDomain: own ?? fallback ?? null };
}

export async function findDomain(slug: string) {
  return prisma.domain.findFirst({
    where: { code: { equals: slug, mode: "insensitive" }, active: true, isSystem: false },
    select: DOMAIN_SELECT,
  });
}

export interface JourneySummary {
  journey: Journey;
  role: JourneyRole | null;
  isPublished: boolean;
  /** Who started the journey, or null once their account is gone. */
  creator: string | null;
}

const CREATOR_SELECT = { createdBy: { select: { firstName: true, lastName: true } } } as const;
const creatorName = (row: { createdBy: { firstName: string | null; lastName: string | null } | null }) =>
  row.createdBy ? fullName(row.createdBy) || null : null;

export async function loadDomainJourneys(viewer: JourneyViewer, domainId: string) {
  const rows = await prisma.onboardingJourney.findMany({
    where: { AND: [{ domainId }, visibleJourneyWhere(viewer)] },
    select: {
      id: true,
      draft: true,
      published: true,
      collaborators: { select: { userId: true, role: true } },
      progress: { where: { userId: viewer.id }, select: { completed: true } },
      ...CREATOR_SELECT,
    },
    orderBy: { createdAt: "asc" },
  });

  const published: JourneySummary[] = [];
  const drafts: JourneySummary[] = [];
  const progress: Record<string, { completed: string[] }> = {};
  for (const row of rows) {
    const role = roleOn(viewer, row.collaborators);
    if (row.published) {
      published.push({ journey: { id: row.id, ...content(row.published) }, role, isPublished: true, creator: creatorName(row) });
      if (row.progress[0]) progress[row.id] = { completed: row.progress[0].completed };
    } else if (role) {
      drafts.push({ journey: { id: row.id, ...content(row.draft) }, role, isPublished: false, creator: creatorName(row) });
    }
  }
  return { published, drafts, progress };
}

/** Every journey the viewer can see, across domains: published ones plus drafts they can edit. */
export async function listViewerJourneys(viewer: JourneyViewer, filter: { id?: string; domainId?: string } = {}) {
  const rows = await prisma.onboardingJourney.findMany({
    where: { AND: [filter, visibleJourneyWhere(viewer)] },
    select: {
      id: true,
      draft: true,
      published: true,
      updatedAt: true,
      domain: { select: { code: true, displayName: true } },
      collaborators: { select: { userId: true, role: true } },
      progress: { where: { userId: viewer.id }, select: { completed: true } },
    },
    orderBy: [{ domain: { displayName: "asc" } }, { createdAt: "asc" }],
  });
  return rows
    .map((row) => {
      const role = roleOn(viewer, row.collaborators);
      const published = row.published ? content(row.published) : null;
      const draft = content(row.draft);
      return {
        id: row.id,
        domain: toDomain(row.domain),
        role,
        published,
        draft: role ? draft : null,
        version: role ? version(row.updatedAt) : null,
        completed: row.progress[0]?.completed ?? null,
      };
    })
    .filter((j) => j.published || j.role);
}

/** One journey for MCP readers: the draft for editors, the live version for everyone. */
export async function loadJourneyById(viewer: JourneyViewer, journeyId: string) {
  return (await listViewerJourneys(viewer, { id: journeyId }))[0] ?? null;
}

/** A published journey as a learner sees it, with their progress. */
export async function loadLearnerJourney(viewer: JourneyViewer, domainId: string, journeyId: string) {
  const row = await prisma.onboardingJourney.findFirst({
    where: { id: journeyId, domainId },
    select: {
      id: true,
      published: true,
      collaborators: { select: { userId: true, role: true } },
      progress: { where: { userId: viewer.id }, select: { completed: true } },
      ...CREATOR_SELECT,
    },
  });
  if (!row?.published) return null;
  return {
    journey: { id: row.id, ...content(row.published) } as Journey,
    creator: creatorName(row),
    role: roleOn(viewer, row.collaborators),
    started: row.progress.length > 0,
    completed: row.progress[0]?.completed ?? [],
  };
}

const PERSON_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  photoUrl: true,
  daliEmail: true,
  dartmouthEmail: true,
  personalEmail: true,
  email: true,
} as const;

export interface JourneyPerson {
  id: string;
  name: string;
  email: string;
  photoUrl: string | null;
}

async function toPerson(u: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  personalEmail: string | null;
  email: string | null;
}): Promise<JourneyPerson> {
  return { id: u.id, name: fullName(u), email: primaryEmail(u) ?? u.email ?? "", photoUrl: await resolvePhotoUrl(u.photoUrl) };
}

export interface JourneyCollaborator extends JourneyPerson {
  role: JourneyRole;
}

async function collaboratorsOf(rows: { role: OnboardingJourneyRole; user: Parameters<typeof toPerson>[0] }[]) {
  const people = await Promise.all(
    rows.map(async (c) => ({ ...(await toPerson(c.user)), role: ROLE_FROM_DB[c.role] })),
  );
  // Owners first, then editors, each alphabetical.
  return people.sort((a, b) => (a.role !== b.role ? (a.role === "owner" ? -1 : 1) : a.name.localeCompare(b.name)));
}

/** The editor's view: the draft, what is live, and the save version. */
export async function loadEditorJourney(viewer: JourneyViewer, domainId: string, journeyId: string) {
  const row = await prisma.onboardingJourney.findFirst({
    where: { id: journeyId, domainId },
    select: {
      id: true,
      draft: true,
      published: true,
      updatedAt: true,
      collaborators: { select: { userId: true, role: true, user: { select: PERSON_SELECT } } },
    },
  });
  if (!row) return null;
  const role = roleOn(viewer, row.collaborators);
  const draft = { id: row.id, ...content(row.draft) } as Journey;
  if (!role) {
    if (!row.published) return null;
    const owners = await collaboratorsOf(row.collaborators.filter((c) => c.role === "Owner"));
    return { role: null, id: row.id, title: draft.title, owners, isPublished: true } as const;
  }
  return {
    role,
    draft,
    published: row.published ? ({ id: row.id, ...content(row.published) } as Journey) : null,
    version: version(row.updatedAt),
  } as const;
}

async function editableRow(viewer: JourneyViewer, journeyId: string) {
  const row = await prisma.onboardingJourney.findUnique({
    where: { id: journeyId },
    select: {
      id: true,
      domainId: true,
      draft: true,
      published: true,
      updatedAt: true,
      collaborators: { select: { userId: true, role: true } },
    },
  });
  if (!row) return null;
  const role = roleOn(viewer, row.collaborators);
  return role ? { row, role } : null;
}

export async function createJourney(viewer: JourneyViewer, domainId: string): Promise<JourneyResult<{ id: string }>> {
  if (!canCreateIn(viewer, domainId)) return fail(403, "You can't start journeys in this domain.");
  const row = await prisma.onboardingJourney.create({
    data: {
      domainId,
      draft: asJson(createJourneyContent()),
      createdById: viewer.id,
      collaborators: { create: { userId: viewer.id, role: "Owner" } },
    },
    select: { id: true },
  });
  return { ok: true, id: row.id };
}

/**
 * Saves the draft only if nobody else saved since `baseVersion`, so two
 * editors can't silently overwrite each other.
 */
export async function saveDraft(
  viewer: JourneyViewer,
  journeyId: string,
  draft: JourneyContent,
  baseVersion: string,
): Promise<JourneyResult<{ version: string }>> {
  const found = await editableRow(viewer, journeyId);
  if (!found) return fail(404, "Journey not found.");
  const base = new Date(baseVersion);
  if (Number.isNaN(base.getTime())) return fail(400, "Missing version.");
  const { count } = await prisma.onboardingJourney.updateMany({
    where: { id: journeyId, updatedAt: base },
    data: { draft: asJson(draft) },
  });
  if (count === 0) return fail(409, "Someone else changed this journey. Reload to get their changes.");
  const saved = await prisma.onboardingJourney.findUniqueOrThrow({ where: { id: journeyId }, select: { updatedAt: true } });
  return { ok: true, version: version(saved.updatedAt) };
}

/** Saves the editor's draft and makes it live in one step, under the same version check as saveDraft. */
export async function publishJourney(
  viewer: JourneyViewer,
  journeyId: string,
  draft: JourneyContent,
  baseVersion: string,
): Promise<JourneyResult<{ version: string }>> {
  const found = await editableRow(viewer, journeyId);
  if (!found) return fail(404, "Journey not found.");
  if (validateJourney(draft).length > 0) return fail(400, "Fix the listed issues before publishing.");
  const base = new Date(baseVersion);
  if (Number.isNaN(base.getTime())) return fail(400, "Missing version.");
  const { count } = await prisma.onboardingJourney.updateMany({
    where: { id: journeyId, updatedAt: base },
    data: { draft: asJson(draft), published: asJson(draft), publishedAt: new Date() },
  });
  if (count === 0) return fail(409, "Someone else changed this journey. Reload to get their changes.");
  const saved = await prisma.onboardingJourney.findUniqueOrThrow({ where: { id: journeyId }, select: { updatedAt: true } });
  return { ok: true, version: version(saved.updatedAt) };
}

/**
 * Applies an edit to the latest saved draft, for callers without an editor
 * open (MCP). Uses the same version check as saveDraft and retries once if
 * someone saved in between. Returns the draft as saved.
 */
export async function editDraft(
  viewer: JourneyViewer,
  journeyId: string,
  edit: (draft: JourneyContent) => JourneyContent | Promise<JourneyContent>,
): Promise<JourneyResult<{ draft: Journey; version: string }>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const found = await editableRow(viewer, journeyId);
    if (!found) return fail(404, "Journey not found.");
    const next = parseJourneyContent(JSON.parse(JSON.stringify(await edit(content(found.row.draft)))));
    if (!next) return fail(400, "That change would leave the journey invalid.");
    const saved = await saveDraft(viewer, journeyId, next, version(found.row.updatedAt));
    if (saved.ok) return { ok: true, draft: { id: journeyId, ...next }, version: saved.version };
    if (saved.status !== 409) return saved;
  }
  return fail(409, "The journey kept changing while saving. Try again.");
}

/** Throws away unpublished changes. A journey that was never published is deleted instead. */
export async function discardDraft(
  viewer: JourneyViewer,
  journeyId: string,
): Promise<JourneyResult<{ deleted: boolean; version?: string }>> {
  const found = await editableRow(viewer, journeyId);
  if (!found) return fail(404, "Journey not found.");
  if (!found.row.published) {
    if (found.role !== "owner") return fail(403, "Only owners can delete a journey.");
    await prisma.onboardingJourney.delete({ where: { id: journeyId } });
    return { ok: true, deleted: true };
  }
  const saved = await prisma.onboardingJourney.update({
    where: { id: journeyId },
    data: { draft: found.row.published as Prisma.InputJsonValue },
    select: { updatedAt: true },
  });
  return { ok: true, deleted: false, version: version(saved.updatedAt) };
}

export async function deleteJourney(viewer: JourneyViewer, journeyId: string): Promise<JourneyResult> {
  const found = await editableRow(viewer, journeyId);
  if (!found) return fail(404, "Journey not found.");
  if (found.role !== "owner") return fail(403, "Only owners can delete a journey.");
  await prisma.onboardingJourney.delete({ where: { id: journeyId } });
  return { ok: true };
}

// ─── Progress ────────────────────────────────────────────────────────────────

export async function startJourney(viewer: JourneyViewer, journeyId: string): Promise<JourneyResult> {
  const row = await prisma.onboardingJourney.findUnique({ where: { id: journeyId }, select: { published: true } });
  if (!row?.published) return fail(404, "Journey not found.");
  await prisma.onboardingJourneyProgress.upsert({
    where: { journeyId_userId: { journeyId, userId: viewer.id } },
    create: { journeyId, userId: viewer.id },
    update: {},
  });
  return { ok: true };
}

/**
 * Records finished modules, labs and quizzes, applied in order so a module's
 * lab or quiz can be recorded in the same request as the module itself.
 * Refuses keys the journey doesn't have, modules whose prerequisites aren't
 * done, and modules whose lab or quiz isn't done.
 */
export async function completeSteps(
  viewer: JourneyViewer,
  journeyId: string,
  keys: string[],
): Promise<JourneyResult<{ completed: string[] }>> {
  const row = await prisma.onboardingJourney.findUnique({
    where: { id: journeyId },
    select: { published: true, progress: { where: { userId: viewer.id }, select: { completed: true } } },
  });
  if (!row?.published) return fail(404, "Journey not found.");
  if (keys.length === 0) return fail(400, "Nothing to record.");
  const journey = content(row.published);
  const valid = progressKeys(journey);
  const done = new Set(row.progress[0]?.completed ?? []);
  const before = done.size;
  for (const key of keys) {
    if (!valid.has(key)) return fail(400, "That isn't part of this journey.");
    const mod = getModule(journey, key.split("#")[0]);
    if (!mod || getModuleStatus(mod, done) === "locked") return fail(400, "Finish the earlier modules first.");
    if (key === mod.id) {
      const missing = (["lab", "quiz"] as const).filter(
        (k) => (k === "lab" ? hasLab(mod) : mod.quiz) && !done.has(activityKey(mod.id, k)),
      );
      if (missing.length) return fail(400, `Finish the ${missing.join(" and ")} first.`);
    }
    if (key === activityKey(mod.id, "lab") && mod.studio && !(await labApproved(viewer.id, journeyId, mod.id, mod.studio))) {
      return fail(400, "A mentor needs to approve this lab first.");
    }
    done.add(key);
  }
  const completed = [...done];
  if (done.size !== before || row.progress.length === 0) {
    await prisma.onboardingJourneyProgress.upsert({
      where: { journeyId_userId: { journeyId, userId: viewer.id } },
      create: { journeyId, userId: viewer.id, completed },
      update: { completed },
    });
  }
  return { ok: true, completed };
}

export async function resetProgress(viewer: JourneyViewer, journeyId: string): Promise<JourneyResult> {
  await prisma.onboardingJourneyProgress.deleteMany({ where: { journeyId, userId: viewer.id } });
  return { ok: true };
}

// ─── Access ──────────────────────────────────────────────────────────────────

export interface AccessEntry {
  id: string;
  title: string;
  creator: string | null;
  domain: JourneyDomain;
  isPublished: boolean;
  role: JourneyRole | null;
  people: JourneyCollaborator[];
}

export async function loadAccessEntries(viewer: JourneyViewer, filter: { id?: string } = {}): Promise<AccessEntry[]> {
  const rows = await prisma.onboardingJourney.findMany({
    where: { AND: [filter, visibleJourneyWhere(viewer)] },
    select: {
      id: true,
      draft: true,
      published: true,
      domain: { select: { code: true, displayName: true } },
      collaborators: { select: { userId: true, role: true, user: { select: PERSON_SELECT } } },
      ...CREATOR_SELECT,
    },
    orderBy: [{ domain: { displayName: "asc" } }, { createdAt: "asc" }],
  });
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      creator: creatorName(row),
      title: (row.published ? content(row.published) : content(row.draft)).title,
      domain: toDomain(row.domain),
      isPublished: row.published !== null,
      role: roleOn(viewer, row.collaborators),
      people: await collaboratorsOf(row.collaborators),
    })),
  );
}

/** Lab members an owner can add to a journey. */
export async function listAddablePeople(): Promise<JourneyPerson[]> {
  const users = await prisma.user.findMany({
    where: ACTIVE_LAB_MEMBER_WHERE,
    select: PERSON_SELECT,
    orderBy: MEMBER_LIST_ORDER_BY,
  });
  return Promise.all(users.map(toPerson));
}

async function managedCollaborators(viewer: JourneyViewer, journeyId: string) {
  const collaborators = await prisma.onboardingJourneyCollaborator.findMany({
    where: { journeyId },
    select: { userId: true, role: true },
  });
  return roleOn(viewer, collaborators) === "owner" ? collaborators : null;
}

/** True when `userId` is the journey's only owner. */
export function isLastOwner(collaborators: { userId: string; role: OnboardingJourneyRole }[], userId: string): boolean {
  const owners = collaborators.filter((c) => c.role === "Owner");
  return owners.length === 1 && owners[0].userId === userId;
}

export async function addCollaborator(
  viewer: JourneyViewer,
  journeyId: string,
  userId: string,
  role: JourneyRole,
): Promise<JourneyResult> {
  const collaborators = await managedCollaborators(viewer, journeyId);
  if (!collaborators) return fail(403, "Only owners can change who has access.");
  if (collaborators.some((c) => c.userId === userId)) return { ok: true };
  const member = await prisma.user.findFirst({ where: { id: userId, ...ACTIVE_LAB_MEMBER_WHERE }, select: { id: true } });
  if (!member) return fail(400, "Only current lab members can be added.");
  await prisma.onboardingJourneyCollaborator.create({ data: { journeyId, userId, role: ROLE_TO_DB[role] } });
  return { ok: true };
}

export async function setCollaboratorRole(
  viewer: JourneyViewer,
  journeyId: string,
  userId: string,
  role: JourneyRole,
): Promise<JourneyResult> {
  const collaborators = await managedCollaborators(viewer, journeyId);
  if (!collaborators) return fail(403, "Only owners can change who has access.");
  if (role !== "owner" && isLastOwner(collaborators, userId)) return fail(400, "Every journey needs at least one owner.");
  await prisma.onboardingJourneyCollaborator.updateMany({ where: { journeyId, userId }, data: { role: ROLE_TO_DB[role] } });
  return { ok: true };
}

export async function removeCollaborator(viewer: JourneyViewer, journeyId: string, userId: string): Promise<JourneyResult> {
  const collaborators = await managedCollaborators(viewer, journeyId);
  if (!collaborators) return fail(403, "Only owners can change who has access.");
  if (isLastOwner(collaborators, userId)) return fail(400, "Every journey needs at least one owner.");
  await prisma.onboardingJourneyCollaborator.deleteMany({ where: { journeyId, userId } });
  return { ok: true };
}
