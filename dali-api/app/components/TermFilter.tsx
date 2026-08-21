import { useSearchParams } from "react-router";
import { termFilterOrder, type TermOption } from "~/lib/terms.shared";
import { Select, type SelectOption } from "~/components/ui/floating";
import { filterPillClass } from "~/components/ui/floating/styles";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { cn } from "~/lib/cn";

// Term dropdown shared by the Projects hub, Members database, Intent to Work
// and Project Bids. Drives the loader via the `?term=` search param so pages
// whose data is term-scoped (the staffing cycles) re-query on change.
// `selected` comes from resolveTermFilter() so the rendered value matches
// what the loader actually used (including the current-term default).
export function TermFilter({
  terms,
  selected,
  // Left undefined so every caller picks up the shared filter pill (and its os
  // dress) automatically; pass one only to override the width or the look.
  buttonClassName,
}: {
  terms: TermOption[];
  selected: string;
  buttonClassName?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const os = useFeatureFlag("os-redesign");

  const options: SelectOption<string>[] = termFilterOrder(terms);

  return (
    <Select
      value={selected}
      options={options}
      ariaLabel="Filter by term"
      buttonClassName={buttonClassName ?? cn(filterPillClass(os), "w-full sm:w-40")}
      onChange={(value) => {
        const next = new URLSearchParams(searchParams);
        next.set("term", value);
        setSearchParams(next);
      }}
    />
  );
}
