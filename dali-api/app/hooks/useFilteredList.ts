import { useMemo, useState, type DependencyList } from "react";

export interface UseFilteredListOptions<T> {
  /** Initial value for the internal search string. Defaults to "". */
  initialSearch?: string;
  /**
   * Pull the searchable strings out of a row. Nullish entries are skipped.
   * The query is matched (case-insensitive substring) against the
   * space-joined, lowercased result.
   */
  searchFields?: (row: T) => Array<string | null | undefined>;
  /** Extra AND-ed predicates (e.g. domain membership). All must pass. */
  predicates?: Array<(row: T) => boolean>;
  /**
   * Inputs the predicates close over (e.g. a selected domainId), folded
   * into the memo dependency list so `filtered` recomputes when they change.
   */
  deps?: DependencyList;
}

export interface UseFilteredListResult<T> {
  search: string;
  setSearch: (value: string) => void;
  filtered: T[];
}

// Pure filter pipeline shared by the hook. Extracted so the load-bearing
// substring-match + predicate AND-ing can be unit-tested without a React
// renderer (no DOM env / @testing-library/react dependency is wired up).
export function filterRows<T>(
  rows: readonly T[],
  search: string,
  searchFields?: (row: T) => Array<string | null | undefined>,
  predicates?: Array<(row: T) => boolean>,
): T[] {
  const q = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (q && searchFields) {
      const haystack = searchFields(row)
        .filter((v): v is string => v != null)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (predicates) {
      for (const pred of predicates) if (!pred(row)) return false;
    }
    return true;
  });
}

export function useFilteredList<T>(
  rows: readonly T[],
  options: UseFilteredListOptions<T> = {},
): UseFilteredListResult<T> {
  const { initialSearch = "", searchFields, predicates } = options;
  const [search, setSearch] = useState(initialSearch);

  const filtered = useMemo(
    () => filterRows(rows, search, searchFields, predicates),
    // `deps` carries predicate-closed-over values (e.g. domainId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, search, ...(options.deps ?? [])],
  );

  return { search, setSearch, filtered };
}
