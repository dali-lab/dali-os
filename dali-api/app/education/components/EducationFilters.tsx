import { useSearchParams } from "react-router";

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export function EducationFilters({
  filters,
  searchPlaceholder = "Search by title…",
}: {
  filters: FilterDef[];
  searchPlaceholder?: string;
}) {
  const [params, setParams] = useSearchParams();

  function setOne(key: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      <input
        type="search"
        placeholder={searchPlaceholder}
        value={params.get("q") ?? ""}
        onChange={(e) => setOne("q", e.target.value)}
        className="rounded-full border border-border bg-card px-4 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-teal min-w-[220px]"
      />
      {filters.map((f) => (
        <label key={f.key} className="text-xs text-muted-foreground inline-flex items-center gap-2">
          {f.label}
          <select
            value={params.get(f.key) ?? ""}
            onChange={(e) => setOne(f.key, e.target.value)}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-sm"
          >
            <option value="">All</option>
            {f.options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
      ))}
      {(params.get("q") || filters.some((f) => params.get(f.key))) && (
        <button
          onClick={() => setParams({}, { replace: true })}
          className="text-xs text-muted-foreground hover:text-dark-blue"
        >
          Clear
        </button>
      )}
    </div>
  );
}

export function matchesFilters<T extends Record<string, any>>(
  item: T,
  params: URLSearchParams,
  spec: { searchFields?: (keyof T)[]; filterFields?: { param: string; field: keyof T }[] },
): boolean {
  const q = (params.get("q") ?? "").trim().toLowerCase();
  if (q && spec.searchFields) {
    const matched = spec.searchFields.some((f) => String(item[f] ?? "").toLowerCase().includes(q));
    if (!matched) return false;
  }
  for (const f of spec.filterFields ?? []) {
    const want = params.get(f.param);
    if (want && String(item[f.field]) !== want) return false;
  }
  return true;
}
