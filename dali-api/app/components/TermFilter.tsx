import { useSearchParams } from "react-router";
import { termFilterOrder, type TermOption } from "~/lib/terms.shared";
import { Combobox, Select, type SelectOption } from "~/components/ui/floating";
import { filterPillClass } from "~/components/ui/floating/styles";
import { cn } from "~/lib/cn";

// The one term picker for every page whose loader is scoped by term. Writes
// `?term=<id>` (or the ALL_TERMS / UPCOMING sentinel) so the loader re-queries.
// `selected` should be the value the loader actually used, e.g. from
// resolveTermFilter(), so the trigger matches the data on screen.
export function TermFilter({
  terms,
  selected,
  // Left undefined so every caller picks up the shared filter pill (and its os
  // dress) automatically; pass one only to override the width or the look.
  buttonClassName,
  // Switchers scope to exactly one term/cycle — no "all terms" view — so they
  // pass includeAll={false}. Forward-planning filters opt into the
  // "Current & upcoming" scope with includeUpcoming.
  includeAll = true,
  includeUpcoming = false,
  // Switchers replace history so the back button doesn't step through every
  // term you flicked past.
  replace = false,
  // Type-to-filter instead of a plain dropdown. Opt-in: on a surface with a
  // couple of terms the list is faster to scan than to type at, so only the
  // places carrying a long term history ask for it.
  searchable = false,
  // Wraps each option's label, e.g. "Active in 26F" where the term scopes
  // something narrower than the whole page.
  formatLabel,
  // Params that belong to the old term (ids picked from its data) and would
  // be stale after a switch.
  clearOnChange = [],
}: {
  terms: TermOption[];
  selected: string;
  buttonClassName?: string;
  includeAll?: boolean;
  includeUpcoming?: boolean;
  replace?: boolean;
  searchable?: boolean;
  formatLabel?: (label: string) => string;
  clearOnChange?: string[];
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const options: SelectOption<string>[] = termFilterOrder(terms, {
    includeAll,
    includeUpcoming,
  }).map((o) => (formatLabel ? { ...o, label: formatLabel(o.label) } : o));

  function apply(value: string) {
    const next = new URLSearchParams(searchParams);
    next.set("term", value);
    for (const key of clearOnChange) next.delete(key);
    setSearchParams(next, { replace });
  }

  const pill = buttonClassName ?? cn(filterPillClass(), "w-full sm:w-40");

  if (searchable) {
    return (
      <Combobox
        value={selected}
        options={options}
        ariaLabel="Filter by term"
        placeholder="Term"
        className={pill}
        onChange={apply}
      />
    );
  }

  return (
    <Select
      value={selected}
      options={options}
      ariaLabel="Filter by term"
      buttonClassName={pill}
      onChange={apply}
    />
  );
}
