import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/education.manage";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { redirectDartmouthToPortal } from "~/education/lib/access.server";
import { listManageable } from "~/education/lib/offerings.server";
import { OfferingCard } from "~/education/components/OfferingCard";
import { buttonClasses } from "~/components/ui/Button";

export const meta: Route.MetaFunction = () => [
  { title: "Manage Education · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectDartmouthToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore && !roles.isInstructor) return redirect("/education");

  const offerings = await listManageable(auth.user.sub);
  return { offerings, isCore: roles.isCore };
}

export default function ManageEducation() {
  const { offerings, isCore } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Manage education
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isCore
              ? "All offerings, drafts included. Create a new offering or open one to edit sessions, review applications, and take attendance."
              : "Offerings you teach. Open one to edit sessions, review applications, and take attendance."}
          </p>
        </div>
        {isCore && (
          <Link to="/education/manage/new" className={buttonClasses("primary", "sm")}>
            New offering
          </Link>
        )}
      </header>

      {offerings.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="font-heading font-semibold text-foreground">
            No offerings yet
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {isCore
              ? "Create the first miniseries or workshop with “New offering”."
              : "You'll see offerings here once Core assigns you as an instructor."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {offerings.map((o) => (
            <OfferingCard
              key={o.id}
              offering={o}
              showStatus
              pendingCount={o.pendingCount}
              to={`/education/manage/${o.id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
