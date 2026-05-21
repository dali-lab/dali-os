// Search (+ optional domain) filter row shared by the Intent to Work and
// Project Bids submission databases. Purely presentational: the parent owns
// the query / domain state and the actual filtering. The domain dropdown is
// optional — the configurable database view filters by free text only.

type Domain = { id: string; name: string };

export function SubmissionFilters({
  query,
  onQueryChange,
  domainId,
  onDomainChange,
  domains,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  domainId?: string;
  onDomainChange?: (id: string) => void;
  domains?: Domain[];
}) {
  const showDomain = !!domains && domains.length > 0 && !!onDomainChange;
  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search by name or email"
        aria-label="Search submissions"
        className="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
      />
      {showDomain && (
        <select
          value={domainId ?? ""}
          onChange={(e) => onDomainChange!(e.target.value)}
          aria-label="Filter by domain"
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground sm:w-56"
        >
          <option value="">All domains</option>
          {domains!.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
