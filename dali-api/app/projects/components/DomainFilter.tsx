// Client-side domain filter dropdown for the Intent to Work and Project Bids
// boards. Filters by member domain eligibility (each row carries its domainIds
// from buildSubmissionView). Standalone so it can sit next to TermFilter,
// matching its look.

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
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter by domain"
      className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground sm:w-40"
    >
      <option value="">All domains</option>
      {domains.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}
