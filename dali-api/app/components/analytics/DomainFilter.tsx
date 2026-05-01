import { useState, useRef, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ChevronDown, Square, CheckSquare } from "lucide-react";

interface Props {
  domains: Array<{ id: string; name: string }>;
  selectedDomainIds: string[];
}

export function DomainFilter({ domains, selectedDomainIds }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const allSelected = selectedDomainIds.length === domains.length;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  function applyFilter(domainIds: string[] | null) {
    const params = new URLSearchParams(searchParams);
    if (domainIds === null || domainIds.length === domains.length) {
      params.delete("domains");
    } else {
      params.set("domains", domainIds.join(","));
    }
    navigate(`/hiring/analytics?${params.toString()}`);
  }

  function toggleDomain(domainId: string) {
    const current = new Set(selectedDomainIds);
    if (current.has(domainId)) {
      current.delete(domainId);
      if (current.size === 0) return;
    } else {
      current.add(domainId);
    }
    applyFilter(Array.from(current));
  }

  function toggleAll() {
    applyFilter(allSelected ? [domains[0].id] : null);
  }

  const label = allSelected
    ? "All Domains"
    : selectedDomainIds.length === 1
      ? domains.find((d) => d.id === selectedDomainIds[0])?.name ?? "1 domain"
      : `${selectedDomainIds.length} domains`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
      >
        {label}
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-52 bg-card border border-border rounded-lg shadow-lg py-1">
          <button
            onClick={toggleAll}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
          >
            {allSelected ? (
              <CheckSquare className="w-4 h-4 text-blue-600 flex-shrink-0" />
            ) : (
              <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            )}
            <span>Select all</span>
          </button>

          <div className="border-t border-border my-1" />

          {domains.map((d) => {
            const checked = selectedDomainIds.includes(d.id);
            return (
              <button
                key={d.id}
                onClick={() => toggleDomain(d.id)}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
              >
                {checked ? (
                  <CheckSquare className="w-4 h-4 text-blue-600 flex-shrink-0" />
                ) : (
                  <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span>{d.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
