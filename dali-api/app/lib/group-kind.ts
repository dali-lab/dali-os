// Client-safe classification of a GroupDefinition by its systemKey. Kept out
// of groups.ts (which imports Prisma) so pickers and pages can use it in
// components. The order is the display order everywhere groups are listed:
// what a person made first, then the lab-wide sets, then the derived ones.

export type GroupKind = "custom" | "lab" | "project" | "domain" | "term" | "offering";

export const GROUP_KIND_ORDER: GroupKind[] = [
  "custom",
  "lab",
  "project",
  "domain",
  "term",
  "offering",
];

export const GROUP_KIND_LABELS: Record<GroupKind, string> = {
  custom: "Custom groups",
  lab: "Lab-wide",
  project: "Projects",
  domain: "Domains",
  term: "Terms",
  offering: "Offerings",
};

type GroupLike = { systemKey: string | null };

export function groupKind(g: GroupLike): GroupKind {
  const key = g.systemKey;
  if (!key) return "custom";
  if (key === "core" || key === "hiring" || key === "alumni") return "lab";
  const prefix = key.split(":", 1)[0];
  if (prefix === "project" || prefix === "domain" || prefix === "term" || prefix === "offering") {
    return prefix;
  }
  return "lab";
}

// An auto group with nobody in it is noise: a future term, an unstaffed
// project, a domain no current member holds. Custom groups are always shown
// since someone made them on purpose.
export function isEmptyAutoGroup(g: GroupLike & { memberIds?: string[]; memberCount?: number }): boolean {
  if (g.systemKey === null) return false;
  const n = g.memberCount ?? g.memberIds?.length ?? 0;
  return n === 0;
}

// Picker order: by kind, then name. Empty auto groups are dropped unless the
// caller is already holding a reference to them (keepIds), so an existing
// selection never silently loses its label.
export function orderGroupsForPicker<T extends GroupLike & { id: string; name: string; memberIds?: string[]; memberCount?: number }>(
  groups: T[],
  keepIds?: Iterable<string>,
): T[] {
  const keep = new Set(keepIds ?? []);
  return groups
    .filter((g) => keep.has(g.id) || !isEmptyAutoGroup(g))
    .sort((a, b) => {
      const ka = GROUP_KIND_ORDER.indexOf(groupKind(a));
      const kb = GROUP_KIND_ORDER.indexOf(groupKind(b));
      if (ka !== kb) return ka - kb;
      return a.name.localeCompare(b.name);
    });
}
