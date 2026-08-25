import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/domains";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { listSkillDomains, currentDomainLeads } from "~/lib/domains.server";
import { fullName } from "~/lib/display";
import { prisma } from "~/lib/db";
import { Avatar } from "~/components/ui/Avatar";

export const handle = {
  breadcrumb: () => "Domains",
};

export const meta: Route.MetaFunction = () => [{ title: "Domains · DALI OS" }];

type DomainLead = { id: string; firstName: string; lastName: string; photoUrl: string | null };

type DomainCard = {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  leads: DomainLead[];
  myLevel: "P1" | "P2" | "P3" | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const roles = await getUserRoles(auth.user.sub, request);
  const enabled = await isFeatureEnabled("domain-hubs", auth.user.sub, roles, request);
  if (!enabled) return redirect("/projects");

  const domains = await listSkillDomains();

  // Viewer's eligibility across all domains — single query, split below.
  const myEligibilities = await prisma.domainEligibility.findMany({
    where: { userId: auth.user.sub },
    select: { domainId: true, level: true },
  });
  const myLevelByDomain = new Map(myEligibilities.map((e) => [e.domainId, e.level]));

  // Load leads per domain in parallel.
  const leadsPerDomain = await Promise.all(
    domains.map((d) => currentDomainLeads(d.id, request)),
  );

  const cards: DomainCard[] = domains.map((d, i) => ({
    id: d.id,
    code: d.code,
    displayName: d.displayName,
    description: d.description,
    leads: leadsPerDomain[i],
    myLevel: (myLevelByDomain.get(d.id) ?? null) as "P1" | "P2" | "P3" | null,
  }));

  const myDomains = cards.filter((c) => c.myLevel !== null);
  const otherDomains = cards.filter((c) => c.myLevel === null);

  return { myDomains, otherDomains };
}

const LEVEL_LABELS: Record<string, string> = {
  P1: "P1 — Learner",
  P2: "P2 — Doer",
  P3: "P3 — Mentor",
};

export default function DomainsIndexPage() {
  const { myDomains, otherDomains } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Domains</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Skill domain knowledge hubs — maintained by each domain's leads.
        </p>
      </header>

      {myDomains.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            Your domains
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {myDomains.map((d) => (
              <DomainCard key={d.id} domain={d} mine />
            ))}
          </div>
        </section>
      )}

      {otherDomains.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {myDomains.length > 0 ? "Explore other domains" : "All domains"}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {otherDomains.map((d) => (
              <DomainCard key={d.id} domain={d} mine={false} />
            ))}
          </div>
        </section>
      )}

      {myDomains.length === 0 && otherDomains.length === 0 && (
        <p className="text-sm text-muted-foreground">No domains configured yet.</p>
      )}
    </div>
  );
}

function DomainCard({ domain, mine }: { domain: DomainCard; mine: boolean }) {
  return (
    <Link
      to={`/domains/${domain.id}`}
      className="border border-border rounded-md bg-background flex flex-col gap-3 p-4 hover:bg-muted/10 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-semibold text-foreground truncate">{domain.displayName}</span>
          {domain.description && (
            <span className="text-xs text-muted-foreground line-clamp-2">{domain.description}</span>
          )}
        </div>
        {mine && domain.myLevel && (
          <span className="flex-shrink-0 inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border bg-accent-teal/15 text-accent-teal border-accent-teal/40">
            {LEVEL_LABELS[domain.myLevel] ?? domain.myLevel}
          </span>
        )}
      </div>
      {domain.leads.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1">
            {domain.leads.slice(0, 3).map((lead) => (
              <Avatar
                key={lead.id}
                name={fullName(lead)}
                photoUrl={lead.photoUrl}
                size="xs"
                className="ring-1 ring-background"
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {domain.leads.length === 1
              ? fullName(domain.leads[0])
              : `${domain.leads.length} leads`}
          </span>
        </div>
      )}
    </Link>
  );
}
