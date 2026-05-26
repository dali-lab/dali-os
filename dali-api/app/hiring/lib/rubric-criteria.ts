// Resolves rubric-criterion keys (stored in ApplicationReview.scores) to their
// human labels for read-only display.
//
// The problem this solves: editing a rubric creates a NEW immutable
// RubricVersion, and newly-added criteria get fresh `crit-<timestamp>` keys.
// Reviews scored against an older version keep those older keys in their
// `scores` JSON. If a consumer only looks at the *current* cycle rubric, any
// key that was added/changed by a later edit no longer resolves and the raw
// `crit-<timestamp>` key leaks into the UI.
//
// Going forward, ApplicationReview.rubricVersionId pins the exact version a
// review's keys belong to (see the review write paths). For reviews written
// before that column existed — or any straggler key — we reconstruct the label
// by scanning the full version history of the relevant rubric(s): every
// RubricVersion sharing the same rubricId is a sibling, so newest-first across
// all of them recovers the label for any key that ever existed.

import { prisma } from "~/lib/db";

export type CriterionMeta = { label: string; maxScore?: number; description?: string };

type RawCriterion = {
  key?: unknown;
  label?: unknown;
  maxScore?: unknown;
  description?: unknown;
};

function coerceCriteria(criteria: unknown): RawCriterion[] {
  return Array.isArray(criteria) ? (criteria as RawCriterion[]) : [];
}

function addCriteria(
  map: Map<string, CriterionMeta>,
  criteria: unknown,
  { overwrite }: { overwrite: boolean },
): void {
  for (const c of coerceCriteria(criteria)) {
    if (typeof c?.key !== "string" || c.key.length === 0) continue;
    if (!overwrite && map.has(c.key)) continue;
    map.set(c.key, {
      label: typeof c.label === "string" && c.label.length > 0 ? c.label : c.key,
      maxScore: typeof c.maxScore === "number" ? c.maxScore : undefined,
      description: typeof c.description === "string" ? c.description : undefined,
    });
  }
}

/**
 * Build a `criterionKey -> { label, maxScore }` map for rendering review
 * scores, resilient to rubric edits.
 *
 * Resolution order (later wins for the "current" layer, earlier wins for
 * history so the most recent label is preferred without being clobbered by
 * older versions):
 *  1. The current cycle rubric criteria (domain + optional general) — the
 *     common case, and the labels we prefer to show.
 *  2. Criteria from any RubricVersion explicitly pinned on a review.
 *  3. A fallback scan of every historical version of the same rubric(s),
 *     newest-first, to recover keys that only the current layer is missing.
 *
 * @param opts.domainRubricVersionId  current domain rubric version for the
 *        cycle (from DomainApplicationCycle.rubricVersionId), if any.
 * @param opts.generalCriteria        general-form rubric criteria array, if any.
 * @param opts.pinnedVersionIds       rubricVersionIds pinned on the reviews
 *        being rendered (ApplicationReview.rubricVersionId).
 */
export async function buildCriteriaLabelMap(opts: {
  domainRubricVersionId?: string | null;
  generalCriteria?: unknown;
  pinnedVersionIds?: (string | null | undefined)[];
}): Promise<Record<string, CriterionMeta>> {
  const map = new Map<string, CriterionMeta>();

  // Layer 1 (preferred): the general-form rubric criteria.
  addCriteria(map, opts.generalCriteria, { overwrite: true });

  // Collect the version ids we want to load directly: the current domain
  // version plus any pinned versions.
  const directIds = new Set<string>();
  if (opts.domainRubricVersionId) directIds.add(opts.domainRubricVersionId);
  for (const id of opts.pinnedVersionIds ?? []) {
    if (id) directIds.add(id);
  }
  if (directIds.size === 0) {
    return Object.fromEntries(map);
  }

  const directVersions = await prisma.rubricVersion.findMany({
    where: { id: { in: Array.from(directIds) } },
    select: { id: true, rubricId: true, versionNumber: true, criteria: true },
  });

  // Layer 1 (preferred, cont.): the current domain version's criteria win over
  // history; pinned versions fill in keys the current version doesn't have.
  const currentVersion = directVersions.find(
    (v) => v.id === opts.domainRubricVersionId,
  );
  if (currentVersion) addCriteria(map, currentVersion.criteria, { overwrite: true });
  for (const v of directVersions) {
    if (v.id === currentVersion?.id) continue;
    addCriteria(map, v.criteria, { overwrite: false });
  }

  // Layer 3 (fallback): scan the full history of the same rubric(s), newest
  // first, to recover any key still unresolved. `overwrite: false` ensures the
  // preferred labels above are never clobbered by older versions.
  const rubricIds = Array.from(new Set(directVersions.map((v) => v.rubricId)));
  if (rubricIds.length > 0) {
    const history = await prisma.rubricVersion.findMany({
      where: { rubricId: { in: rubricIds } },
      orderBy: { versionNumber: "desc" },
      select: { criteria: true },
    });
    for (const v of history) {
      addCriteria(map, v.criteria, { overwrite: false });
    }
  }

  return Object.fromEntries(map);
}

/**
 * Array form of {@link buildCriteriaLabelMap}, for consumers that thread a flat
 * `{ key, label, maxScore, description }[]` (e.g. domain-lead's ReviewModal,
 * which builds its own key map). Same edit-resilient resolution, returned as an
 * array (current/general criteria first, then any extra keys recovered from
 * history).
 */
export async function buildCriteriaList(opts: {
  domainRubricVersionId?: string | null;
  generalCriteria?: unknown;
  pinnedVersionIds?: (string | null | undefined)[];
}): Promise<Array<{ key: string } & CriterionMeta>> {
  const map = await buildCriteriaLabelMap(opts);
  return Object.entries(map).map(([key, meta]) => ({ key, ...meta }));
}
