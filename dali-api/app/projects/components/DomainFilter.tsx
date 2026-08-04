// Client-side domain filter dropdown for the Intent to Work and Project Bids
// boards. Filters by member domain eligibility (each row carries its domainIds
// from buildSubmissionView). Standalone so it can sit next to TermFilter,
// matching its look.

import { Select, type SelectOption } from "~/components/ui/floating";

type Domain = { id: string; name: string };

export function DomainFilter({
  domains,
  value,
  onChange,
}: {
  domains: Domain[];
  value: string;
  onChange: (id: string) => void;
}) {
  const options: SelectOption<string>[] = [
    { value: "", label: "All domains" },
    ...domains.map((d) => ({ value: d.id, label: d.name })),
  ];
  return (
    <Select
      value={value}
      options={options}
      ariaLabel="Filter by domain"
      buttonClassName="inline-flex w-full items-center justify-between gap-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground transition-colors hover:bg-muted/40 sm:w-40"
      onChange={onChange}
    />
  );
}
