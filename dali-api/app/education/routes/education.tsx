import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/education";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { redirectDartmouthToPortal } from "~/education/lib/access.server";
import { listCatalog } from "~/education/lib/offerings.server";
import { OfferingCard } from "~/education/components/OfferingCard";
import { educationPills } from "~/education/components/educationPills";
import { AreaPillNav } from "~/components/AreaPillNav";

export const meta: Route.MetaFunction = () => [{ title: "Education · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectDartmouthToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const [offerings, roles] = await Promise.all([
    listCatalog(auth.user.sub),
    getUserRoles(auth.user.sub),
  ]);
  return {
    offerings,
    canManage: roles.isCore || roles.isInstructor,
    isCore: roles.isCore,
  };
}

export default function EducationCatalog() {
  const { offerings, canManage, isCore } = useLoaderData<typeof loader>();
  const enrolled = offerings.filter((o) => o.myStatus === "Approved");

  return (
    <div className="flex flex-col gap-6">
      <AreaPillNav items={educationPills({ canManage, isCore, active: "hub" })} />
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Education
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Miniseries and workshops run by the lab. Apply or RSVP to a
          published offering; once you&apos;re in, the course hub has
          sessions, materials, and assignments.
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
                to={`/education/${o.id}/hub`}
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
            <p className="font-heading font-semibold text-foreground">
              Nothing published yet
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Published miniseries and workshops will show up here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {offerings.map((o) => (
              <OfferingCard
                key={o.id}
                offering={o}
                myStatus={o.myStatus}
                to={`/education/${o.id}`}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
