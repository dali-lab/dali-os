import { Link } from "react-router";
import type { NavCluster } from "~/lib/cluster-nav";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

// Shared cluster-hub body: a heading + a card per section. Used by the Admin
// and Core cluster landing routes, which are otherwise identical. The cards
// carry their destination's name and nothing else — a hub is a set of doors,
// and a sentence under each one restates the label it sits below.
export function ClusterHub({ cluster }: { cluster: NavCluster | undefined }) {
  const { os, pageTitle, card, cardPad, heading, headingIcon } = useOsChrome();
  if (!cluster) return null;
  return (
    <div className={cn("flex flex-col", os ? "gap-6" : "gap-4")}>
      <header>
        <h1 className={pageTitle}>{cluster.label}</h1>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cluster.sections.map((s) => (
          <Link
            key={s.key}
            to={s.to}
            className={cn(
              card,
              cardPad,
              os
                ? "transition-colors hover:bg-os-card-hover"
                : "hover:border-accent-coral/60 hover:shadow-brand-2 transition-all",
            )}
          >
            <div className="flex items-center gap-2">
              <s.icon className={cn("shrink-0", headingIcon)} aria-hidden />
              <h2 className={heading}>{s.label}</h2>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
