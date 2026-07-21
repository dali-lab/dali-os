import { useNavigate, useSearchParams } from "react-router";

interface Props {
  domains: Array<{ id: string; name: string }>;
  selectedDomainId: string | null;
}

export function DomainToggle({ domains, selectedDomainId }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  function select(domainId: string | null) {
    const params = new URLSearchParams(searchParams);
    if (domainId === null) params.delete("domain");
    else params.set("domain", domainId);
    params.delete("status");
    navigate({ search: `?${params.toString()}` });
  }

  const options: Array<{ id: string | null; name: string }> = [
    { id: null, name: "All Domains" },
    ...domains.map((d) => ({ id: d.id, name: d.name })),
  ];

  return (
    <div className="inline-flex max-w-full items-center overflow-x-auto rounded-md border border-border">
      {options.map((opt) => {
        const active = (opt.id ?? null) === (selectedDomainId ?? null);
        return (
          <button
            key={opt.id ?? "__all__"}
            type="button"
            aria-pressed={active}
            onClick={() => select(opt.id)}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 text-sm transition-colors ${
              active
                ? "bg-accent-coral/15 text-accent-coral"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {opt.name}
          </button>
        );
      })}
    </div>
  );
}
