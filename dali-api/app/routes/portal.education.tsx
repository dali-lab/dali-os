import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education";
import { requireAuth } from "~/lib/auth";
import { listCatalog } from "~/education/lib/offerings.server";
import { OfferingCard } from "~/education/components/OfferingCard";

export const meta: Route.MetaFunction = () => [
  { title: "Education · DALI" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  // Lab members use the member-shell education surface instead.
  if (auth.user.type === "member") return redirect("/education");

  const offerings = await listCatalog(auth.user.sub);
  return { offerings };
}

export default function PortalEducation() {
  const { offerings } = useLoaderData<typeof loader>();
  const enrolled = offerings.filter((o) => o.myStatus === "Approved");

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-bold text-dark-blue">
          Education at DALI
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Miniseries and workshops open to Dartmouth students — no lab
          membership required. Apply or RSVP below; once you&apos;re accepted,
          the course hub with sessions and materials opens up here.
        </p>
      </header>

      {enrolled.length > 0 && (
        <section>
          <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            You&apos;re enrolled in
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {enrolled.map((o) => (
              <OfferingCard
                key={o.id}
                offering={o}
                myStatus={o.myStatus}
                openAssignments={o.openAssignments}
                to={`/portal/education/${o.id}/hub`}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        {enrolled.length > 0 && (
          <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            All offerings
          </h2>
        )}
        {offerings.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-8 text-center">
            <p className="font-heading font-semibold text-dark-blue">
              Nothing scheduled right now
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Check back soon — new miniseries and workshops are posted here
              each term.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {offerings.map((o) => (
              <OfferingCard
                key={o.id}
                offering={o}
                myStatus={o.myStatus}
                to={`/portal/education/${o.id}`}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
