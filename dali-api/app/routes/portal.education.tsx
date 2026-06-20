import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education";
import { requireAuth } from "~/lib/auth";
import { listPublishedOfferings } from "~/education/lib/offerings-data";
import { listApplicationsForUser } from "~/education/lib/applications-data";
import { OfferingCard } from "~/education/components/OfferingCard";

export const meta: Route.MetaFunction = () => [{ title: "Education · DALI" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const [offerings, myApplications] = await Promise.all([
    listPublishedOfferings(),
    listApplicationsForUser(auth.user.sub),
  ]);

  const myStatusByOffering = new Map<string, string>();
  for (const a of myApplications) myStatusByOffering.set(a.offering.id, a.status);

  return {
    offerings: offerings.map((o) => ({
      id: o.id,
      title: o.title,
      type: o.type,
      startsAt: o.startsAt.toISOString(),
      endsAt: o.endsAt.toISOString(),
      registrationClosesAt: o.registrationClosesAt.toISOString(),
      capacity: o.capacity,
      approvedCount: o._count.applications,
      myStatus: (myStatusByOffering.get(o.id) ?? null) as
        | "Submitted" | "Approved" | "Waitlisted" | "Rejected" | "Withdrawn" | null,
    })),
    enrolled: myApplications
      .filter((a) => a.status === "Approved")
      .map((a) => ({ id: a.offering.id, title: a.offering.title, type: a.offering.type })),
  };
}

export default function PortalEducationCatalog() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="px-6 md:px-16 lg:px-24 py-10 max-w-4xl mx-auto">
      <header className="mb-8">
        <h1 className="font-heading text-2xl font-bold text-dark-blue">DALI Education</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse and apply to miniseries and workshops led by DALI members.
        </p>
        <div className="mt-3 text-xs text-muted-foreground">
          <Link to="/portal" className="text-accent-coral hover:underline">
            ← Back to applicant home
          </Link>
        </div>
      </header>

      {data.enrolled.length > 0 && (
        <section className="mb-10">
          <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
            You're enrolled in
          </h2>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.enrolled.map((o) => (
              <li key={o.id}>
                <Link to={`/portal/education/${o.id}/enrolled`} className="block rounded-2xl border border-border bg-card p-4 hover:shadow-brand-2 transition">
                  <p className="text-xs uppercase tracking-wider text-accent-teal mb-1">{o.type}</p>
                  <p className="font-semibold text-dark-blue">{o.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
          Open offerings
        </h2>
        {data.offerings.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Nothing open right now — check back soon.
          </p>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.offerings.map((o) => (
              <li key={o.id}>
                <OfferingCard
                  id={o.id}
                  title={o.title}
                  type={o.type}
                  startsAt={o.startsAt}
                  endsAt={o.endsAt}
                  capacity={o.capacity}
                  approvedCount={o.approvedCount}
                  registrationClosesAt={o.registrationClosesAt}
                  enrolledStatus={o.myStatus}
                  hrefPrefix="/portal/education"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
