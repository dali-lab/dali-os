import { Link, redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/education";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { getUserRoles } from "~/lib/roles";
import { listPublishedOfferings } from "~/education/lib/offerings-data";
import { listApplicationsForUser } from "~/education/lib/applications-data";
import { OfferingCard } from "~/education/components/OfferingCard";
import { EducationFilters, matchesFilters } from "~/education/components/EducationFilters";

export const meta: Route.MetaFunction = () => [{ title: "Education · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal/education");

  const [offerings, myApplications, roles] = await Promise.all([
    listPublishedOfferings(),
    listApplicationsForUser(auth.user.sub),
    getUserRoles(auth.user.sub),
  ]);

  const myStatusByOffering = new Map<string, string>();
  for (const a of myApplications) {
    myStatusByOffering.set(a.offering.id, a.status);
  }

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
      .map((a) => ({
        id: a.offering.id,
        title: a.offering.title,
        type: a.offering.type,
        nextSessionAt: a.offering.sessions[0]?.datetime?.toISOString() ?? null,
      })),
    canManage: roles.isCore || roles.isInstructor,
  };
}

export default function EducationCatalog() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const filtered = data.offerings.filter((o) =>
    matchesFilters(o, params, {
      searchFields: ["title"],
      filterFields: [{ param: "type", field: "type" }],
    }),
  );
  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold text-dark-blue">Education</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Miniseries and workshops led by DALI members.
          </p>
        </div>
        {data.canManage && (
          <Link
            to="/education/manage"
            className="text-sm text-accent-coral hover:underline"
          >
            Manage offerings →
          </Link>
        )}
      </header>

      {data.enrolled.length > 0 && (
        <section className="mb-10">
          <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
            You're enrolled in
          </h2>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.enrolled.map((o) => (
              <li key={o.id}>
                <Link to={`/education/enrolled/${o.id}`} className="block rounded-2xl border border-border bg-card p-4 hover:shadow-brand-2 transition">
                  <p className="text-xs uppercase tracking-wider text-accent-teal mb-1">{o.type}</p>
                  <p className="font-semibold text-dark-blue">{o.title}</p>
                  {o.nextSessionAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Next session {new Date(o.nextSessionAt).toLocaleString()}
                    </p>
                  )}
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
        <EducationFilters
          filters={[{
            key: "type",
            label: "Type",
            options: [
              { value: "Miniseries", label: "Miniseries" },
              { value: "Workshop", label: "Workshop" },
            ],
          }]}
        />
        {data.offerings.length === 0 ? (
          <EmptyState title="Nothing open right now" body="Check back soon — new offerings publish throughout the term." />
        ) : filtered.length === 0 ? (
          <EmptyState title="No matches" body="Try clearing filters or searching for a different term." />
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((o) => (
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
                  hrefPrefix="/education/offerings"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-brand-tint/30 p-6 text-center">
      <p className="font-heading text-base font-bold text-dark-blue">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{body}</p>
    </div>
  );
}
