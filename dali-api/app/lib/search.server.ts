import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { LAB_MEMBER_WHERE } from "~/lib/prisma-shapes";
import type { UserRoles } from "~/lib/roles";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import {
  buildUrl,
  computeHiringVisibility,
  MIN_QUERY_LENGTH,
  rankResults,
  type SearchResult,
} from "~/lib/search";

// Server side of the command-palette search: permission-scoped Prisma queries
// that feed the pure ranking in lib/search.ts. Each category is scoped to what
// the caller may already reach — see the per-category notes below.

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

  const like = { contains: q, mode: "insensitive" as const };
  // Over-fetch a bounded set per category, then rank+cap in JS. At lab scale a
  // 2+ char substring query returns few rows; the cap bounds payload + render.
  const RAW_TAKE = 40;

  const [people, projects, offerings, partners, documents] = await Promise.all([
    prisma.user.findMany({
      where: {
        ...LAB_MEMBER_WHERE,
        OR: [{ firstName: like }, { lastName: like }, { daliEmail: like }, { dartmouthEmail: like }],
      },
      select: { id: true, firstName: true, lastName: true, daliEmail: true, dartmouthEmail: true },
      take: RAW_TAKE,
    }),
    // Archived projects are effectively retired — keep them out of quick-jump.
    prisma.project.findMany({
      where: { status: { not: "Archived" }, name: like },
      select: { id: true, name: true },
      take: RAW_TAKE,
    }),
    // Only Published offerings are member-visible; Draft/Archived stay hidden.
    prisma.educationOffering.findMany({
      where: { status: "Published", title: like },
      select: { id: true, title: true },
      take: RAW_TAKE,
    }),
    prisma.partnerOrg.findMany({
      where: { name: like },
      select: { id: true, name: true },
      take: RAW_TAKE,
    }),
    // Any authenticated member may already open any live page by URL (only
    // editing is gated), so title search matches that existing view surface.
    prisma.page.findMany({
      where: { archivedAt: null, title: like },
      select: { id: true, title: true },
      take: RAW_TAKE,
    }),
  ]);

  const results: SearchResult[] = [];

  results.push(
    ...rankResults(
      people.map((u) => {
        const name = `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || "Member";
        const email = u.daliEmail ?? u.dartmouthEmail ?? undefined;
        return {
          result: { type: "person", id: u.id, title: name, subtitle: email, url: buildUrl.person(u.id) },
          text: [name, email ?? ""],
        };
      }),
      q,
    ),
  );

  results.push(
    ...rankResults(
      projects.map((p) => ({
        result: { type: "project", id: p.id, title: p.name, subtitle: "Project", url: buildUrl.project(p.id) },
        text: [p.name],
      })),
      q,
    ),
  );

  results.push(
    ...rankResults(
      offerings.map((o) => ({
        result: { type: "education", id: o.id, title: o.title, subtitle: "Education", url: buildUrl.education(o.id) },
        text: [o.title],
      })),
      q,
    ),
  );

  results.push(
    ...rankResults(
      partners.map((o) => ({
        result: { type: "partner", id: o.id, title: o.name, subtitle: "Partner", url: buildUrl.partner(o.id) },
        text: [o.name],
      })),
      q,
    ),
  );

  results.push(
    ...rankResults(
      documents.map((d) => ({
        result: { type: "document", id: d.id, title: d.title || "Untitled", subtitle: "Document", url: buildUrl.document(d.id) },
        text: [d.title || ""],
      })),
      q,
    ),
  );

  results.push(...(await searchApplications(opts.userId, opts.roles, q, like)));

  return results;
}

// Role-gated applicant search — kept separate because its visibility rules are
// the security-critical part. Mirrors app/hiring/routes/applications.tsx and
// additionally requires the cycle's confidentiality agreement to be signed
// before any applicant name is disclosed (stricter than the list view).
async function searchApplications(
  userId: string,
  roles: UserRoles,
  q: string,
  like: { contains: string; mode: "insensitive" },
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
    take: 40,
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
