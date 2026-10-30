import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db.server";
import { LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import type { UserRoles } from "~/lib/roles";
import { confidentialityCleared, getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { TASK_STATUS_LABELS } from "~/projects/lib/task-board";
import {
  buildUrl,
  computeHiringVisibility,
  GUIDE_PAGES,
  MIN_QUERY_LENGTH,
  PER_CATEGORY_CAP,
  pageKindLabel,
  rankResults,
  searchPageKind,
  type SearchResult,
  type SearchResultType,
} from "~/lib/search";
import { searchPageContent } from "~/lib/doc-search.server";
import { resolveSections } from "~/lib/page-doc-sections";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import { PAGE_ACCESS_SELECT, getPageAccessBulk } from "~/lib/pageAccess.server";
import { HELP_ARTICLES } from "~/lib/help-articles";
import { categorize } from "~/lib/file-type";

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
    searchDocuments(opts.userId, q, like),
    // Page guides ("Docs") and /help articles — both readable by every lab
    // member, so ungated like docs.
    searchGuides(q),
    searchHelpArticles(q),
    searchProjectFiles(q, like),
    searchApplications(opts.userId, roles, q, like),
    roles.canViewForms ? searchGroups(q, like) : NONE,
    searchFormPages(opts.userId, q, like),
    // Hiring library (reusable artifacts) — Core or Domain Lead, mirroring the
    // library routes. Names aren't sensitive; the routes already gate.
    roles.isCore || roles.isDomainLead ? searchRubrics(q, like) : NONE,
    roles.isCore || roles.isDomainLead ? searchAgreements(q, like) : NONE,
    // Core-only artifacts.
    roles.isCore ? searchCycles(q, like) : NONE,
    // Partner orgs/contacts — Core-only, like every /core/partners/orgs and
    // /core/partners/contacts route.
    roles.isCore ? searchPartnerOrgs(q, like) : NONE,
    roles.isCore ? searchPartnerContacts(q, like) : NONE,
    // Partner applications — Core/Admin (canViewStaffing), like the internal view.
    roles.canViewStaffing ? searchPartnerApplications(q, like) : NONE,
  ];

  return (await Promise.all(tasks)).flat();
}

// Map a set of {id, label} rows of a single type to ranked results. Used by the
// simple name/title categories; richer ones (people, partner apps) inline it.
function simpleResults(
  type: Exclude<SearchResultType, "task">,
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
        type: "task" as const,
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
  // type so files share the Drive section with pages.
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
        subtitle: f.project?.name ?? "",
        url: `/documents/file/${f.id}`,
        fileCategory: categorize({ fileName: f.currentVersion?.fileName || f.title || "" }),
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

async function searchPartnerContacts(q: string, like: Like): Promise<SearchResult[]> {
  const rows = await prisma.partnerContact.findMany({
    where: { OR: [{ name: like }, { email: like }] },
    select: { id: true, name: true, email: true },
    take: RAW_TAKE,
  });
  return rankResults(
    rows.map((c) => ({
      result: {
        type: "partnerContact" as const,
        id: c.id,
        title: c.name,
        subtitle: c.email,
        url: buildUrl.partnerContact(c.id),
      },
      text: [c.name, c.email],
    })),
    q,
  );
}

async function searchDocuments(userId: string, q: string, like: Like): Promise<SearchResult[]> {
  // Titles and bodies are searched separately and merged rather than scored
  // together: a title match is what someone means the overwhelming majority of
  // the time, so it keeps its place at the top of the category and body
  // matches fill whatever room is left.
  //
  // Both passes over-fetch because access is checked after the query; filtering
  // a tight limit would starve the category when the viewer cannot open most hits.
  const [titleRows, rawContentHits] = await Promise.all([
    prisma.page.findMany({
      where: { archivedAt: null, kind: { not: "Form" }, title: like },
      select: { ...PAGE_ACCESS_SELECT, title: true, iconEmoji: true, kind: true },
      take: RAW_TAKE * 3,
    }),
    searchPageContent(q, PER_CATEGORY_CAP * 3),
  ]);

  const contentPages = rawContentHits.length
    ? await prisma.page.findMany({
        where: { id: { in: rawContentHits.map((h) => h.pageId) } },
        select: PAGE_ACCESS_SELECT,
      })
    : [];
  const access = await getPageAccessBulk(userId, [...titleRows, ...contentPages]);
  const canView = (id: string) => access.get(id)?.canView === true;

  const rows = titleRows.filter((r) => canView(r.id));
  const contentHits = rawContentHits.filter((h) => canView(h.pageId));

  const kindById = new Map(rows.map((r) => [r.id, searchPageKind(r.kind)]));
  const titleResults = simpleResults(
    "document",
    "Document",
    rows.map((r) => ({ id: r.id, label: r.title, iconEmoji: r.iconEmoji })),
    q,
  ).map((r) => {
    const pageKind = kindById.get(r.id);
    return pageKind ? { ...r, pageKind, subtitle: pageKindLabel(pageKind) } : r;
  });

  const seen = new Set(titleResults.map((r) => r.id));
  const contentResults = contentHits
    .filter((hit) => !seen.has(hit.pageId))
    .map((hit) => {
      const pageKind = searchPageKind(hit.kind);
      return {
        type: "document" as const,
        id: hit.pageId,
        title: hit.title,
        // The matched sentence says why this document came back when its title
        // gave nothing away.
        subtitle: hit.snippet || pageKindLabel(pageKind),
        url: buildUrl.document(hit.pageId),
        iconEmoji: hit.iconEmoji,
        ...(pageKind && { pageKind }),
      };
    });

  return [...titleResults, ...contentResults].slice(0, PER_CATEGORY_CAP);
}

// Flatten a guide's authored content into one searchable string: each section's
// title plus its body text (legacy ProseMirror bodies convert to blocks first).
function guideContentText(row: { body: unknown; sections: unknown }): string {
  return resolveSections({ body: row.body, videoKey: null, sections: row.sections })
    .map((s) => `${s.title} ${blocksToPlainText(ensureBlocks(s.body))}`)
    .join(" ");
}

async function searchGuides(q: string): Promise<SearchResult[]> {
  // The guide set is fixed and tiny (GUIDE_PAGES), so load the authored rows and
  // rank in memory. A guide still ranks on its declared title/keywords before
  // anyone has opened it to create its PageDoc row.
  const rows = await prisma.pageDoc.findMany({
    where: { pageKey: { in: GUIDE_PAGES.map((g) => g.pageKey) } },
    select: { pageKey: true, title: true, body: true, sections: true },
  });
  const byKey = new Map(rows.map((r) => [r.pageKey, r]));

  return rankResults(
    GUIDE_PAGES.map((g) => {
      const row = byKey.get(g.pageKey);
      const title = row?.title?.trim() || g.title;
      return {
        result: {
          type: "guide" as const,
          id: g.pageKey,
          title,
          subtitle: "Guide",
          url: buildUrl.guide(g.pageKey),
        },
        text: [title, ...(g.keywords ?? []), row ? guideContentText(row) : ""],
      };
    }),
    q,
  );
}

// Help-center articles (/help/*). A fully static set (HELP_ARTICLES), so there's
// no query — just rank its title/summary/keywords in memory.
async function searchHelpArticles(q: string): Promise<SearchResult[]> {
  return rankResults(
    HELP_ARTICLES.map((a) => ({
      result: {
        type: "helpArticle" as const,
        id: a.slug,
        title: a.title,
        subtitle: "Help",
        url: buildUrl.helpArticle(a.slug),
      },
      text: [a.title, a.summary, ...(a.keywords ?? [])],
    })),
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

async function searchFormPages(userId: string, q: string, like: Like): Promise<SearchResult[]> {
  const pages = await prisma.page.findMany({
    where: { kind: "Form", archivedAt: null, title: like },
    select: { ...PAGE_ACCESS_SELECT, title: true, iconEmoji: true },
    take: RAW_TAKE,
  });
  const access = await getPageAccessBulk(userId, pages);
  return simpleResults(
    "form",
    "Form",
    pages.filter((p) => access.get(p.id)?.canView).map((p) => ({ id: p.id, label: p.title, iconEmoji: p.iconEmoji })),
    q,
  );
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
    where: { name: like, gateScope: "HiringCycle", archivedAt: null },
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
  // this user has access to (signed, or Core/Admin, who are exempt). Core is
  // exempt by definition, so the per-cycle check (three queries per cycle ever
  // run, on every keystroke) only runs for reviewers, who hold a few cycles.
  const signedCycleIds = roles.isCore
    ? candidateCycleIds
    : (
        await Promise.all(
          candidateCycleIds.map(async (id) =>
            confidentialityCleared(await getCycleConfidentialityState(userId, id)) ? id : null,
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
      // Standard cycles link Domain via challengeVersion; Fellowship links it
      // directly — match whichever path is set (mirrors the reviewer route).
      OR: pairs.map((r) => ({
        application: { applicationCycleId: r.applicationCycleId, ...nameMatch },
        domainId: r.domainId,
      })),
    };
  }

  const apps = await prisma.domainApplication.findMany({
    where,
    select: {
      id: true,
      domain: { select: { displayName: true } },
      application: { select: { user: { select: { firstName: true, lastName: true } } } },
    },
    take: RAW_TAKE,
  });

  return rankResults(
    apps.map((da) => {
      const u = da.application.user;
      const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Applicant";
      const domain = da.domain?.displayName;
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
