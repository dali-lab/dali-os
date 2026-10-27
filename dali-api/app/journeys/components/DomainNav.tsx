import { useNavigate } from "react-router";
import { Select } from "~/components/ui/floating";
import { domainPath } from "~/journeys/lib/paths";

type DomainLink = { slug: string; name: string };

export function DomainNav({ domains, active }: { domains: DomainLink[]; active: string }) {
  const navigate = useNavigate();
  return (
    <div className="self-start pt-4">
      <Select
        ariaLabel="Domain"
        value={active}
        options={domains.map((d) => ({ value: d.slug, label: d.name }))}
        onChange={(slug) => navigate(domainPath(slug))}
        buttonClassName="inline-flex min-w-48 items-center justify-between gap-2 rounded-os-item border border-os-container bg-os-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-os-hover"
      />
    </div>
  );
}
