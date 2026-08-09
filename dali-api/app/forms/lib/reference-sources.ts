import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import {
  REFERENCE_SOURCE_LABELS,
  isReferenceSourceKey,
  type ReferenceSourceKey,
} from "./reference-sources.shared";

// Server side of `reference` question data sources. A `reference` question's
// choices come from one of these curated loaders instead of a hardcoded
// list. A form (an immutable FormVersion) stores only the source KEY; the
// rows are resolved fresh every time the form is filled, so "open this term"
// stays correct without re-versioning the form. Admins pick from this vetted
// set — they never supply a query, so a form can't be pointed at arbitrary
// tables.
//
// Each loader returns `{ value, label }[]`: `label` is shown in the dropdown,
// `value` is what gets stored as the answer. `value` is a real DB id (e.g. a
// projectId), which is what makes a reference answer usable by structured
// flows like staffing later.
//
// The label/key set lives in reference-sources.shared.ts (client-safe, used
// by the editor); the `satisfies` below makes adding a key there without a
// loader here a compile error, and vice versa.

export type { ReferenceOption, ProjectOptionCard } from "./reference-sources.shared";
import type { ReferenceOption } from "./reference-sources.shared";

// Context a loader may use to scope its options. `userId` is the member
// filling the form, when known — absent on the public/unauthenticated path.
// `termId` is per-question authoring config (the term the form author chose
// for a term-scoped source), not member context. Most loaders ignore both;
// member-scoped sources require userId, term-scoped sources require termId,
// and each degrades to [] without what it needs.
export type ReferenceContext = {
  userId?: string | null;
  termId?: string | null;
};

// Every `projects:*` source excludes private projects. A private project is
// one Core/Admin has marked as not offerable — it must never appear as a
// choice on a bid/preference form, for any filling member. Applied here (one
// shared predicate) rather than per-loader so a new projects source can't
// forget it.
const NOT_PRIVATE = { isPrivate: false } as const;

// One shared select for every `projects:*` source, so all three render the
// same card. domainScopes is fetched unfiltered and narrowed to the card's
// term in toProjectOption — a project runs few terms, so this stays one query
// per source rather than one per row.
const PROJECT_CARD_SELECT = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  // Current partners only; an ended partnership isn't who you'd be working with.
  partners: {
    where: { endedAt: null },
    select: { partnerOrg: { select: { name: true } } },
  },
  domainScopes: {
    select: { termId: true, scope: true, domain: { select: { name: true } } },
  },
  projectTerms: { select: { termId: true, term: { select: { sortKey: true } } } },
} as const;

type ProjectCardRow = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  partners: { partnerOrg: { name: string } }[];
  domainScopes: { termId: string; scope: string; domain: { name: string } }[];
  projectTerms: { termId: string; term: { sortKey: number } }[];
};

// A project's Statement of Work is whichever of its documents carries the
// "SOW" doc tag — there is no dedicated column for it (ProjectTermStatus has
// a sowPageId, but nothing in the app ever writes it). Tags are lab-wide and
// slugified from the label, so "SOW" lands on this slug.
const SOW_TAG_SLUG = "sow";

// Resolved for the whole option list in one query rather than per card. If a
// project somehow carries the tag on several documents, the first in page
// order wins so the pick is stable between loads.
async function sowPageIdByProject(
  projectIds: string[],
): Promise<Map<string, string>> {
  const byProject = new Map<string, string>();
  if (projectIds.length === 0) return byProject;

  const pages = await prisma.page.findMany({
    where: {
      workspaceType: "Project",
      workspaceId: { in: projectIds },
      archivedAt: null,
      isTemplate: false,
      tags: { some: { tag: { slug: SOW_TAG_SLUG, archivedAt: null } } },
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, workspaceId: true },
  });

  for (const page of pages) {
    if (page.workspaceId && !byProject.has(page.workspaceId)) {
      byProject.set(page.workspaceId, page.id);
    }
  }
  return byProject;
}

// Build one card option. `scopeTermId` is the term the source scopes to, or
// null for the term-less `projects:active` — which falls back to the
// project's latest term (highest sortKey) so its card still shows the most
// recent challenges rather than nothing.
async function toProjectOption(
  p: ProjectCardRow,
  scopeTermId: string | null,
  sowPageId: string | null,
): Promise<ReferenceOption> {
  const latestTermId =
    [...p.projectTerms].sort((a, b) => b.term.sortKey - a.term.sortKey)[0]
      ?.termId ?? null;
  const termId = scopeTermId ?? latestTermId;

  return {
    value: p.id,
    label: p.name,
    card: {
      description: p.description,
      imageUrl: await resolvePhotoUrl(p.imageUrl),
      partners: p.partners.map((pp) => pp.partnerOrg.name),
      challenges: p.domainScopes
        .filter((s) => s.termId === termId && s.scope.trim() !== "")
        .map((s) => ({ domain: s.domain.name, scope: s.scope }))
        .sort((a, b) => a.domain.localeCompare(b.domain)),
      sowPageId,
    },
  };
}

// Every `projects:*` loader ends here, so the SOW lookup can't be forgotten
// by a new source.
async function toProjectOptions(
  projects: ProjectCardRow[],
  scopeTermId: string | null,
): Promise<ReferenceOption[]> {
  const sowPages = await sowPageIdByProject(projects.map((p) => p.id));
  return Promise.all(
    projects.map((p) => toProjectOption(p, scopeTermId, sowPages.get(p.id) ?? null)),
  );
}

const LOADERS = {
  // Projects a member can bid on this term: non-archived projects that run
  // this term (ProjectTerm) AND declare at least one domain (ProjectDomain).
  // Biddability is domain-driven now, not gated on ProjectRoleRequest — a
  // project with declared scope is biddable even without manually-entered role
  // requests (see bid-validation.ts).
  "projects:open-this-term": async () => {
    const term = await currentTerm();
    if (!term) return [];
    const projects = await prisma.project.findMany({
      where: {
        ...NOT_PRIVATE,
        status: { not: "Archived" },
        projectTerms: { some: { termId: term.id } },
        domains: { some: {} },
      },
      orderBy: { name: "asc" },
      select: PROJECT_CARD_SELECT,
    });
    return toProjectOptions(projects, term.id);
  },
  // Every non-archived project, regardless of term.
  "projects:active": async () => {
    const projects = await prisma.project.findMany({
      where: { ...NOT_PRIVATE, status: { not: "Archived" } },
      orderBy: { name: "asc" },
      select: PROJECT_CARD_SELECT,
    });
    return toProjectOptions(projects, null);
  },
  // Non-archived projects whose term set includes the term the form author
  // chose (ctx.termId, from the question's data.referenceTermId). Term-scoped:
  // with no termId it resolves to [] rather than listing every project, so a
  // misconfigured question yields an empty dropdown instead of wrong data.
  "projects:active-in-term": async (ctx?: ReferenceContext) => {
    if (!ctx?.termId) return [];
    const projects = await prisma.project.findMany({
      where: {
        ...NOT_PRIVATE,
        status: { not: "Archived" },
        projectTerms: { some: { termId: ctx.termId } },
      },
      orderBy: { name: "asc" },
      select: PROJECT_CARD_SELECT,
    });
    return toProjectOptions(projects, ctx.termId);
  },
  // Active domains (Design, Dev, …).
  "domains:active": async () => {
    const domains = await prisma.domain.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    });
    return domains.map((d) => ({ value: d.id, label: d.displayName }));
  },
  // Only the domains the FILLING member is eligible in (their
  // DomainEligibility rows). Member-scoped: with no userId (public path) it
  // resolves to [] so the dropdown is simply empty rather than leaking the
  // full domain list. The stored value is the domainId, same as
  // domains:active, so a ranked bid's domain is a trustworthy id downstream.
  "domains:my-eligibility": async (ctx?: ReferenceContext) => {
    if (!ctx?.userId) return [];
    const rows = await prisma.domainEligibility.findMany({
      where: { userId: ctx.userId },
      select: { domainId: true, domain: { select: { displayName: true } } },
    });
    return rows
      .map((r) => ({ value: r.domainId, label: r.domain.displayName }))
      .sort((a, b) => a.label.localeCompare(b.label));
  },
} satisfies Record<
  ReferenceSourceKey,
  (ctx?: ReferenceContext) => Promise<ReferenceOption[]>
>;

// Re-export the client-safe helpers so server callers have one import.
export {
  REFERENCE_SOURCE_LABELS,
  isReferenceSourceKey,
  referenceSourceChoices,
  referenceSourceNeedsTerm,
} from "./reference-sources.shared";
export type { ReferenceSourceKey } from "./reference-sources.shared";

// Resolve one source's options, or [] if the key is unknown (a form that
// references a since-removed source degrades to an empty dropdown rather than
// throwing). `ctx` carries the filling member when known; member-scoped
// sources need it and return [] without it.
export async function resolveReferenceOptions(
  key: string | undefined | null,
  ctx?: ReferenceContext,
): Promise<ReferenceOption[]> {
  if (!isReferenceSourceKey(key)) return [];
  return LOADERS[key](ctx);
}
