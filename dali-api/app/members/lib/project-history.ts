export type TermGroup<T> = { termCode: string; isCurrent: boolean; assignments: T[] };

export function groupAssignmentsByTerm<
  T extends { term: { id: string; code: string; sortKey: number } },
>(rows: T[], currentTermId: string | null): TermGroup<T>[] {
  const groups = new Map<string, { sortKey: number; group: TermGroup<T> }>();
  for (const row of rows) {
    let entry = groups.get(row.term.id);
    if (!entry) {
      entry = {
        sortKey: row.term.sortKey,
        group: { termCode: row.term.code, isCurrent: row.term.id === currentTermId, assignments: [] },
      };
      groups.set(row.term.id, entry);
    }
    entry.group.assignments.push(row);
  }
  return [...groups.values()]
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((e) => e.group);
}
