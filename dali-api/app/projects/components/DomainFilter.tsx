// Client-side domain filter dropdown for the Intent to Work and Project Bids
// boards. Filters by member domain eligibility (each row carries its domainIds
// from buildSubmissionView). Standalone so it can sit next to TermFilter,
// matching its look.

import { Select, type SelectOption } from "~/components/ui/floating";
import { filterPillClass } from "~/components/ui/floating/styles";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { cn } from "~/lib/cn";

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
  const os = useFeatureFlag("os-redesign");
  const options: SelectOption<string>[] = [
    { value: "", label: "All domains" },
    ...domains.map((d) => ({ value: d.id, label: d.name })),
  ];
  return (
    <Select
      value={value}
      options={options}
      ariaLabel="Filter by domain"
      buttonClassName={cn(filterPillClass(os), "w-full sm:w-40")}
      onChange={onChange}
    />
  );
}
