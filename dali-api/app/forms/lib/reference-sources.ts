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
  // Active domains (Design, Dev, …).
  "domains:active": async () => {
    const domains = await prisma.domain.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    });
    return domains.map((d) => ({ value: d.id, label: d.displayName }));
  },
} satisfies Record<ReferenceSourceKey, () => Promise<ReferenceOption[]>>;

// Re-export the client-safe helpers so server callers have one import.
export {
  REFERENCE_SOURCE_LABELS,
  isReferenceSourceKey,
  referenceSourceChoices,
} from "./reference-sources.shared";
export type { ReferenceSourceKey } from "./reference-sources.shared";

// Resolve one source's options, or [] if the key is unknown (a form that
// references a since-removed source degrades to an empty dropdown rather than
// throwing).
export async function resolveReferenceOptions(
  key: string | undefined | null,
): Promise<ReferenceOption[]> {
  if (!isReferenceSourceKey(key)) return [];
  return LOADERS[key]();
}
