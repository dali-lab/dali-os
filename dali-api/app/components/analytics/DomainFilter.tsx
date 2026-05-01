import { useNavigate, useSearchParams } from "react-router";

interface Props {
  allDomains: Array<{ id: string; name: string }>;
  selectedDomainIds: string[];
  userDomainIds: string[];
}

export function DomainFilter({ allDomains, selectedDomainIds, userDomainIds }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const allSelected = selectedDomainIds.length === allDomains.length;

  function applyFilter(domainIds: string[] | null) {
    const params = new URLSearchParams(searchParams);
    if (domainIds === null || domainIds.length === allDomains.length) {
      params.delete("domains");
    } else {
      params.set("domains", domainIds.join(","));
    }
    navigate(`/analytics?${params.toString()}`);
  }

  function toggleDomain(domainId: string) {
    const current = new Set(selectedDomainIds);
    if (current.has(domainId)) {
      current.delete(domainId);
      if (current.size === 0) return; // don't allow empty selection
    } else {
      current.add(domainId);
    }
    applyFilter(Array.from(current));
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground mr-1">Domains:</span>
      <button
        onClick={() => applyFilter(null)}
        className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
          allSelected
            ? "bg-blue-600 text-white border-blue-600"
            : "bg-card text-muted-foreground border-border hover:border-blue-300"
        }`}
      >
        All
      </button>
      {userDomainIds.length > 0 && !allSelected && (
        <button
          onClick={() => applyFilter(userDomainIds)}
          className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
            userDomainIds.length === selectedDomainIds.length &&
            userDomainIds.every((id) => selectedDomainIds.includes(id))
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-card text-muted-foreground border-border hover:border-blue-300"
          }`}
        >
          My Domains
        </button>
      )}
      {allDomains.map((d) => {
        const isSelected = selectedDomainIds.includes(d.id);
        const isUserDomain = userDomainIds.includes(d.id);
        return (
          <button
            key={d.id}
            onClick={() => toggleDomain(d.id)}
            className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
              isSelected
                ? "bg-blue-100 text-blue-700 border-blue-300"
                : "bg-card text-muted-foreground border-border hover:border-blue-300"
            } ${isUserDomain && !allSelected ? "ring-1 ring-blue-400/40" : ""}`}
          >
            {d.name}
          </button>
        );
      })}
    </div>
  );
}
