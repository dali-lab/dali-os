import { Link } from "react-router";
import type { NavCluster } from "~/lib/cluster-nav";

// Shared cluster-hub body: a heading + a card per section. Used by the Admin
// and Core cluster landing routes, which are otherwise identical.
export function ClusterHub({ cluster }: { cluster: NavCluster | undefined }) {
  if (!cluster) return null;
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {cluster.label}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{cluster.description}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cluster.sections.map((s) => (
          <Link
            key={s.key}
            to={s.to}
            className="bg-card border border-border shadow-brand-1 rounded-lg p-4 hover:border-accent-coral/60 hover:shadow-brand-2 transition-all"
          >
            <div className="flex items-center gap-2">
              <s.icon className="h-4 w-4 text-accent-coral shrink-0" aria-hidden />
              <h2 className="font-heading font-semibold text-foreground">{s.label}</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{s.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
