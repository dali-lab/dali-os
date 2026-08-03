import { useSearchParams } from "react-router";
import { ALL_TERMS, type TermOption } from "~/lib/terms.shared";
import { SelectMenu, type SelectMenuOption } from "~/components/ui/SelectMenu";

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

  const options: SelectMenuOption<string>[] = [
    ...terms.map((t) => ({ value: t.id, label: t.code })),
    { value: ALL_TERMS, label: "All terms" },
  ];

  return (
    <SelectMenu
      value={selected}
      options={options}
      ariaLabel="Filter by term"
      buttonClassName="inline-flex w-full items-center justify-between gap-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground transition-colors hover:bg-muted/40 sm:w-40"
      onChange={(value) => {
        const next = new URLSearchParams(searchParams);
        next.set("term", value);
        setSearchParams(next);
      }}
    />
  );
}
