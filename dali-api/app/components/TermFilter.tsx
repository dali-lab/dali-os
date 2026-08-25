import { useSearchParams } from "react-router";
import { termFilterOrder, type TermOption } from "~/lib/terms.shared";
import { Select, type SelectOption } from "~/components/ui/floating";
import { filterPillClass } from "~/components/ui/floating/styles";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { cn } from "~/lib/cn";

// Term dropdown shared by every term-scoped surface — list filters (Projects
// hub, Members, Intent to Work, Project Bids, Education management, Partner
// applications…) and mandatory single-term switchers (staffing cycle,
// agreements focus term, payroll export). Drives the loader via the `?term=`
// search param so term-scoped data re-queries on change. `selected` comes from
// resolveTermFilter() so the rendered value matches what the loader actually
// used (including the current-term / current-&-upcoming default).
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
}: {
  terms: TermOption[];
  selected: string;
  buttonClassName?: string;
  includeAll?: boolean;
  includeUpcoming?: boolean;
  replace?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const os = useFeatureFlag("os-redesign");

  const options: SelectOption<string>[] = termFilterOrder(terms, {
    includeAll,
    includeUpcoming,
  });

  return (
    <Select
      value={selected}
      options={options}
      ariaLabel="Filter by term"
      buttonClassName={buttonClassName ?? cn(filterPillClass(os), "w-full sm:w-40")}
      onChange={(value) => {
        const next = new URLSearchParams(searchParams);
        next.set("term", value);
        setSearchParams(next, { replace });
      }}
    />
  );
}
