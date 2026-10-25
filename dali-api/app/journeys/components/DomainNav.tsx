import { Link, useNavigate } from "react-router";
import { Select } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { domainPath } from "~/journeys/lib/paths";

type DomainLink = { slug: string; name: string };

export function DomainNav({ domains, active }: { domains: DomainLink[]; active: string }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="lg:hidden">
        <Select
          ariaLabel="Domain"
          value={active}
          options={domains.map((d) => ({ value: d.slug, label: d.name }))}
          onChange={(slug) => navigate(domainPath(slug))}
        />
      </div>
      <nav aria-label="Domains" className="hidden self-start lg:sticky lg:top-6 lg:block">
        <ul className="flex flex-col gap-0.5 border-l border-os-container">
          {domains.map((d) => (
            <li key={d.slug}>
              <Link
                to={domainPath(d.slug)}
                aria-current={d.slug === active ? "page" : undefined}
                className={cn(
                  "-ml-px block border-l-2 px-3 py-1.5 text-sm transition-colors",
                  d.slug === active
                    ? "border-os-accent font-medium text-foreground"
                    : "border-transparent text-os-grey hover:text-foreground",
                )}
              >
                {d.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
