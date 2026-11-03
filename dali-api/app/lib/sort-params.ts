export type SortDir = "asc" | "desc";
export type Sort<K extends string> = { key: K; dir: SortDir };

// A table's sort as `?sort=<column>&dir=<asc|desc>`. The default sort stays
// out of the URL, and an unknown column falls back to it.
export function readSortParams<K extends string>(
  params: URLSearchParams,
  keys: readonly K[],
  fallback: Sort<K>,
): Sort<K> {
  const key = params.get("sort");
  if (!keys.includes(key as K)) return fallback;
  const dir = params.get("dir");
  return { key: key as K, dir: dir === "asc" || dir === "desc" ? dir : fallback.dir };
}

export function writeSortParams<K extends string>(
  prev: URLSearchParams,
  sort: Sort<K>,
  fallback: Sort<K>,
): URLSearchParams {
  const params = new URLSearchParams(prev);
  params.delete("sort");
  params.delete("dir");
  if (sort.key !== fallback.key || sort.dir !== fallback.dir) {
    params.set("sort", sort.key);
    params.set("dir", sort.dir);
  }
  return params;
}
