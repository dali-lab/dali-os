import { useSearchParams } from "react-router";
import { ALL_TERMS, type TermOption } from "~/lib/terms.shared";

// Term dropdown shared by the Projects hub, Members database, Intent to Work
// and Project Bids. Drives the loader via the `?term=` search param so pages
// whose data is term-scoped (the staffing cycles) re-query on change.
// `selected` comes from resolveTermFilter() so the rendered value matches
// what the loader actually used (including the current-term default).
export function TermFilter({
  terms,
  selected,
}: {
  terms: TermOption[];
  selected: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  return (
    <select
      value={selected}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams);
        next.set("term", e.target.value);
        setSearchParams(next);
      }}
      aria-label="Filter by term"
      className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground sm:w-40"
    >
      {terms.map((t) => (
        <option key={t.id} value={t.id}>
          {t.code}
        </option>
      ))}
      <option value={ALL_TERMS}>All terms</option>
    </select>
  );
}
