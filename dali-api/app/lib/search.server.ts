import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import type { UserRoles } from "~/lib/roles";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { TASK_STATUS_LABELS } from "~/projects/lib/task-board";
import {
  buildUrl,
  computeHiringVisibility,
  MIN_QUERY_LENGTH,
  rankResults,
  type SearchResult,
  type SearchResultType,
} from "~/lib/search";

// Server side of the command-palette search: permission-scoped Prisma queries
// that feed the pure ranking in lib/search.ts. Each category is a small helper
// gated to what the caller may already reach; runSearch fans them out and
// concatenates. Matching is case-insensitive substring, ranked + capped per
// category in the pure layer.

type Like = { contains: string; mode: "insensitive" };
const RAW_TAKE = 40; // over-fetch per category, then rank+cap in JS.
const NONE = Promise.resolve<SearchResult[]>([]);

export async function runSearch(opts: {
  userId: string;
  roles: UserRoles;
  q: string;
}): Promise<SearchResult[]> {
  const q = opts.q.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];
  // Not a lab member (e.g. an applicant who reached the endpoint directly) —
  // nothing to surface. The palette itself only mounts in the member shell.
  if (!opts.roles.isLabMember) return [];

  const roles = opts.roles;
  const like: Like = { contains: q, mode: "insensitive" };

  const tasks: Promise<SearchResult[]>[] = [
    searchPeople(q, like),
    searchProjects(q, like),
    searchTasks(q, like),
    searchOfferings(q, like),
    searchPartnerOrgs(q, like),
    searchDocuments(q, like),
    searchProjectFiles(q, like),
    searchApplications(opts.userId, roles, q, like),
    // Groups, forms & folders — Forms area gate.
    roles.canViewForms ? searchGroups(q, like) : NONE,
    roles.canViewForms ? searchForms(q, like) : NONE,
    roles.canViewForms ? searchFormFolders(q, like) : NONE,
    // Hiring library (reusable artifacts) — Core or Domain Lead, mirroring the
    // library routes. Names aren't sensitive; the routes already gate.
    roles.isCore || roles.isDomainLead ? searchChallenges(q, like) : NONE,
    roles.isCore || roles.isDomainLead ? searchRubrics(q, like) : NONE,
    roles.isCore || roles.isDomainLead ? searchAgreements(q, like) : NONE,
    // Core-only artifacts.
    roles.isCore ? searchEmailTemplates(q, like) : NONE,
    roles.isCore ? searchCycles(q, like) : NONE,
    // Partner applications — Core/Admin (canViewStaffing), like the internal view.
    roles.canViewStaffing ? searchPartnerApplications(q, like) : NONE,
  ];

  return (await Promise.all(tasks)).flat();
}

// Map a set of {id, label} rows of a single type to ranked results. Used by the
// simple name/title categories; richer ones (people, partner apps) inline it.
function simpleResults(
  type: SearchResultType,
  subtitle: string,
  rows: { id: string; label: string | null; iconEmoji?: string | null }[],
  q: string,
): SearchResult[] {
  return rankResults(
    rows.map((r) => ({
      result: {
        type,
        id: r.id,
        title: r.label || "Untitled",
        subtitle,
        url: buildUrl[type](r.id),
        iconEmoji: r.iconEmoji,
      },
      text: [r.label || ""],
    })),
    q,
  );
}

async function searchPeople(q: string, like: Like): Promise<SearchResult[]> {
  const rows = await prisma.user.findMany({
    where: {
      ...LAB_MEMBER_WHERE,
      OR: [{ firstName: like }, { lastName: like }, { daliEmail: like }, { dartmouthEmail: like }],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
      photoUrl: true,
    },
    take: RAW_TAKE,
  });
  const ranked = rankResults(
    rows.map((u) => {
      const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Member";
      const email = u.daliEmail ?? u.dartmouthEmail ?? undefined;
      return {
        result: { type: "person", id: u.id, title: name, subtitle: email, url: buildUrl.person(u.id) },
        text: [name, email ?? ""],
      };
    }),
    q,
  );
  // Resolve avatars only for the ranked survivors (≤ PER_CATEGORY_CAP), not the
  // full over-fetch — keeps per-keystroke work tiny.
  const rawPhotoById = new Map(rows.map((u) => [u.id, u.photoUrl]));
  return Promise.all(
    ranked.map(async (result) => ({
      ...result,
      photoUrl: await resolvePhotoUrl(rawPhotoById.get(result.id)),
    })),
  );
}

async function searchProjects(q: string, like: Like): Promise<SearchResult[]> {
  // Archived projects are effectively retired — keep them out of quick-jump.
  // Description matches too (a project is often findable by what it does, not
  // what it's called), so it must feed the ranker as a scored field.
  const rows = await prisma.project.findMany({
    where: { status: { not: "Archived" }, OR: [{ name: like }, { description: like }] },
    select: { id: true, name: true, description: true, iconEmoji: true },
    take: RAW_TAKE,
  });
  return rankResults(
    rows.map((p) => ({
      result: {
        type: "project" as const,
        id: p.id,
        title: p.name,
        subtitle: "Project",
        url: buildUrl.project(p.id),
        iconEmoji: p.iconEmoji,
      },
      text: [p.name, p.description ?? ""],
    })),
    q,
  );
}

async function searchTasks(q: string, like: Like): Promise<SearchResult[]> {
  // Every member can open every project's board, so tasks get the same
  // scoping as projects: members-only auth, Archived projects excluded.
  // Reuses the "project" result type so the palette needs no new icon/section;
  // the url deep-links to the task modal on the project board.
  const rows = await prisma.task.findMany({
    // archivedAt: auto-archived Done/Cancelled tasks are off the board, so
    // they shouldn't surface here either.
    where: { title: like, archivedAt: null, project: { status: { not: "Archived" } } },
    select: {
      id: true,
      title: true,
      status: true,
      projectId: true,
      project: { select: { name: true } },
    },
    take: RAW_TAKE,
  });
  return rankResults(
    rows.map((t) => ({
      result: {
        type: "project" as const,
        id: t.id,
        title: t.title,
        subtitle: `${t.project.name} · ${TASK_STATUS_LABELS[t.status]}`,
        url: `/projects/${t.projectId}?tab=board&task=${t.id}`,
      },
      text: [t.title],
    })),
    q,
  );
}

async function searchProjectFiles(q: string, like: Like): Promise<SearchResult[]> {
  // Uploaded project files; archived ones are out, mirroring pages. Matches
  // the display title or the current version's original filename (a file is
  // often remembered by what it was uploaded as). Reuses the "document" result
  // type — same section/icon as pages.
  const rows = await prisma.projectFile.findMany({
    where: {
      archivedAt: null,
      OR: [{ title: like }, { currentVersion: { fileName: like } }],
    },
    select: {
      id: true,
      title: true,
      currentVersion: { select: { fileName: true } },
      project: { select: { name: true } },
    },
    take: RAW_TAKE,
  });
  return rankResults(
    rows.map((f) => ({
      result: {
        type: "document" as const,
        id: f.id,
        title: f.title || "Untitled",
        subtitle: f.project.name,
        url: `/documents/file/${f.id}`,
      },
      text: [f.title, f.currentVersion?.fileName ?? ""],
    })),
    q,
  );
}

async function searchOfferings(q: string, like: Like): Promise<SearchResult[]> {
  // Only Published offerings are member-visible; Draft/Archived stay hidden.
  const rows = await prisma.educationOffering.findMany({
    where: { status: "Published", title: like },
    select: { id: true, title: true },
    take: RAW_TAKE,
  });
  return simpleResults("education", "Education", rows.map((r) => ({ id: r.id, label: r.title })), q);
}

async function searchPartnerOrgs(q: string, like: Like): Promise<SearchResult[]> {
  const rows = await prisma.partnerOrg.findMany({
    where: { name: like },
    select: { id: true, name: true },
    take: RAW_TAKE,
  });
  return simpleResults("partner", "Partner", rows.map((r) => ({ id: r.id, label: r.name })), q);
}

async function searchDocuments(q: string, like: Like): Promise<SearchResult[]> {
  // Any authenticated member may already open any live page by URL (only
  // editing is gated), so title search matches that existing view surface.
  const rows = await prisma.page.findMany({
    where: { archivedAt: null, title: like },
    select: { id: true, title: true, iconEmoji: true },
    take: RAW_TAKE,
  });
  return simpleResults(
    "document",
    "Document",
    rows.map((r) => ({ id: r.id, label: r.title, iconEmoji: r.iconEmoji })),
    q,
  );
}

async function searchGroups(q: string, like: Like): Promise<SearchResult[]> {
  // Member groups (People → Groups). Archived groups are out, mirroring the
  // list's default "active" filter. Gated with the Forms area, like the sub-tab.
  const rows = await prisma.groupDefinition.findMany({
    where: { name: like, archivedAt: null },
    select: { id: true, name: true },
    take: RAW_TAKE,
  });
  return simpleResults("group", "Group", rows.map((r) => ({ id: r.id, label: r.name })), q);
}

async function searchForms(q: string, like: Like): Promise<SearchResult[]> {
  const rows = await prisma.form.findMany({
    where: { name: like },
    select: { id: true, name: true },
    take: RAW_TAKE,
  });
  return simpleResults("form", "Form", rows.map((r) => ({ id: r.id, label: r.name })), q);
}

async function searchFormFolders(q: string, like: Like): Promise<SearchResult[]> {
  const rows = await prisma.formFolder.findMany({
    where: { name: like },
    select: { id: true, name: true },
    take: RAW_TAKE,
  });
  return simpleResults("formFolder", "Folder", rows.map((r) => ({ id: r.id, label: r.name })), q);
}

async function searchChallenges(q: string, like: Like): Promise<SearchResult[]> {
  const rows = await prisma.challenge.findMany({
    where: { name: like },
    select: { id: true, name: true },
    take: RAW_TAKE,
  });
  return simpleResults("challenge", "Challenge", rows.map((r) => ({ id: r.id, label: r.name })), q);
}

async function searchRubrics(q: string, like: Like): Promise<SearchResult[]> {
  const rows = await prisma.rubric.findMany({
    where: { name: like },
    select: { id: true, name: true },
    take: RAW_TAKE,
  });
  return simpleResults("rubric", "Rubric", rows.map((r) => ({ id: r.id, label: r.name })), q);
}

async function searchAgreements(q: string, like: Like): Promise<SearchResult[]> {
  const rows = await prisma.signingDocument.findMany({
    where: { name: like, kind: "Confidentiality", archivedAt: null },
    select: { id: true, name: true },
    take: RAW_TAKE,
  });
  return simpleResults(
    "confidentialityAgreement",
    "Confidentiality agreement",
    rows.map((r) => ({ id: r.id, label: r.name })),
    q,
  );
}

async function searchEmailTemplates(q: string, like: Like): Promise<SearchResult[]> {
  const rows = await prisma.emailTemplate.findMany({
    where: { name: like },
    select: { id: true, name: true },
    take: RAW_TAKE,
  });
  return simpleResults("emailTemplate", "Email template", rows.map((r) => ({ id: r.id, label: r.name })), q);
}

async function searchCycles(q: string, like: Like): Promise<SearchResult[]> {
  const rows = await prisma.applicationCycle.findMany({
    where: { name: like },
    select: { id: true, name: true },
    take: RAW_TAKE,
  });
  return simpleResults("cycle", "Hiring cycle", rows.map((r) => ({ id: r.id, label: r.name })), q);
}

async function searchPartnerApplications(q: string, like: Like): Promise<SearchResult[]> {
  const rows = await prisma.partnerApplication.findMany({
    where: { title: like },
    select: { id: true, title: true, partnerOrg: { select: { name: true } } },
    take: RAW_TAKE,
  });
  return rankResults(
    rows.map((r) => ({
      result: {
        type: "partnerApplication" as const,
        id: r.id,
        title: r.title || "Untitled",
        subtitle: r.partnerOrg?.name ?? "Partner application",
        url: buildUrl.partnerApplication(r.id),
      },
      text: [r.title || ""],
    })),
    q,
  );
}

// Role-gated applicant search — the security-critical part. Mirrors
// app/hiring/routes/applications.tsx and additionally requires the cycle's
// confidentiality agreement to be signed before any applicant name is disclosed
// (stricter than the list view).
async function searchApplications(
  userId: string,
  roles: UserRoles,
  q: string,
  like: Like,
): Promise<SearchResult[]> {
  const reviewerRows = await prisma.cycleReviewer.findMany({
    where: { userId },
    select: { applicationCycleId: true, domainId: true },
  });
  if (!roles.isCore && reviewerRows.length === 0) return [];

  const visibility = computeHiringVisibility(roles.isCore, reviewerRows);

  const candidateCycleIds = visibility.all
    ? (await prisma.applicationCycle.findMany({ select: { id: true } })).map((c) => c.id)
    : [...new Set(reviewerRows.map((r) => r.applicationCycleId))];

  // Leak-proofing: only cycles whose currently-bound confidentiality agreement
  // this user has signed. Applies to Core too (no-agreement → nobody sees).
  const signedCycleIds = (
    await Promise.all(
      candidateCycleIds.map(async (id) =>
        (await getCycleConfidentialityState(userId, id)).status === "signed" ? id : null,
      ),
    )
  ).filter((id): id is string => id !== null);
  if (signedCycleIds.length === 0) return [];

  const nameMatch = { user: { OR: [{ firstName: like }, { lastName: like }] } };
  let where: Prisma.DomainApplicationWhereInput;
  if (visibility.all) {
    where = {
      selected: true,
      application: { applicationCycleId: { in: signedCycleIds }, ...nameMatch },
    };
  } else {
    const pairs = visibility.pairs.filter((r) => signedCycleIds.includes(r.applicationCycleId));
    if (pairs.length === 0) return [];
    where = {
      selected: true,
      // Standard cycles link Domain via challengeVersion; InternToFull links it
      // directly — match whichever path is set (mirrors the reviewer route).
      OR: pairs.map((r) => ({
        application: { applicationCycleId: r.applicationCycleId, ...nameMatch },
        OR: [{ challengeVersion: { domainId: r.domainId } }, { domainId: r.domainId }],
      })),
    };
  }

  const apps = await prisma.domainApplication.findMany({
    where,
    select: {
      id: true,
      domain: { select: { displayName: true } },
      challengeVersion: { select: { domain: { select: { displayName: true } } } },
      application: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
    take: RAW_TAKE,
  });

  return rankResults(
    apps.map((da) => {
      const u = da.application.user;
      const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Applicant";
      const domain = da.domain?.displayName ?? da.challengeVersion?.domain?.displayName;
      return {
        result: {
          type: "application" as const,
          id: da.id,
          title: name,
          subtitle: domain ? `Applicant · ${domain}` : "Applicant",
          url: buildUrl.application(da.id),
        },
        text: [name],
      };
    }),
    q,
  );
}
