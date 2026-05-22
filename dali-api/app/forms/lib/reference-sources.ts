import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
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

export type ReferenceOption = { value: string; label: string };

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

const LOADERS = {
  // Projects with at least one open role this term — mirrors the projects a
  // member can actually bid on (see api.project-bids.ts role-request gate).
  "projects:open-this-term": async () => {
    const term = await currentTerm();
    if (!term) return [];
    const roleRequests = await prisma.projectRoleRequest.findMany({
      where: { termId: term.id },
      select: { projectId: true },
    });
    const projectIds = [...new Set(roleRequests.map((r) => r.projectId))];
    if (projectIds.length === 0) return [];
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return projects.map((p) => ({ value: p.id, label: p.name }));
  },
  // Every non-archived project, regardless of term.
  "projects:active": async () => {
    const projects = await prisma.project.findMany({
      where: { status: { not: "Archived" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return projects.map((p) => ({ value: p.id, label: p.name }));
  },
  // Non-archived projects whose term set includes the term the form author
  // chose (ctx.termId, from the question's data.referenceTermId). Term-scoped:
  // with no termId it resolves to [] rather than listing every project, so a
  // misconfigured question yields an empty dropdown instead of wrong data.
  "projects:active-in-term": async (ctx?: ReferenceContext) => {
    if (!ctx?.termId) return [];
    const projects = await prisma.project.findMany({
      where: {
        status: { not: "Archived" },
        projectTerms: { some: { termId: ctx.termId } },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return projects.map((p) => ({ value: p.id, label: p.name }));
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
