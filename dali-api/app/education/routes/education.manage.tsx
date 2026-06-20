import { Link, redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/education.manage";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { manageableOfferingIds } from "~/education/lib/auth";
import { listManageableOfferings } from "~/education/lib/offerings-data";
import { EducationFilters, matchesFilters } from "~/education/components/EducationFilters";

export const meta: Route.MetaFunction = () => [{ title: "Manage offerings · Education" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal/education");

  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore && !roles.isInstructor) {
    throw new Response("Forbidden", { status: 403 });
  }

  const scope = await manageableOfferingIds(auth.user.sub);
  const offerings = await listManageableOfferings(scope);

  return {
    isCore: roles.isCore,
    offerings: offerings.map((o) => ({
      id: o.id,
      title: o.title,
      type: o.type,
      status: o.status,
      capacity: o.capacity,
      startsAt: o.startsAt.toISOString(),
      pendingApplications: o._count.applications,
      sessionCount: o._count.sessions,
    })),
  };
}

export default function ManageOfferings() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const filtered = data.offerings.filter((o) =>
    matchesFilters(o, params, {
      searchFields: ["title"],
      filterFields: [
        { param: "type", field: "type" },
        { param: "status", field: "status" },
      ],
    }),
  );
  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-dark-blue">Manage offerings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Edit settings, sessions, applications, and announcements.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data.isCore && (
            <Link
              to="/education/manage/templates"
              className="text-sm text-accent-coral hover:underline"
            >
              Templates →
            </Link>
          )}
          {data.isCore && (
            <Link
              to="/education/manage/new"
              className="text-sm text-white bg-accent-coral hover:bg-accent-coral/90 px-4 py-2 rounded-full font-semibold"
            >
              + New offering
            </Link>
          )}
        </div>
      </header>

      <EducationFilters
        filters={[
          {
            key: "type",
            label: "Type",
            options: [
              { value: "Miniseries", label: "Miniseries" },
              { value: "Workshop", label: "Workshop" },
            ],
          },
          {
            key: "status",
            label: "Status",
            options: [
              { value: "Draft", label: "Draft" },
              { value: "Published", label: "Published" },
              { value: "Archived", label: "Archived" },
            ],
          },
        ]}
      />

      {data.offerings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-brand-tint/30 p-6 text-center">
          <p className="font-heading text-base font-bold text-dark-blue">Nothing to manage yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            {data.isCore ? "Create a draft to get started." : "Ask Core to add you as an instructor on an offering."}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-brand-tint/30 p-6 text-center">
          <p className="font-heading text-base font-bold text-dark-blue">No matches</p>
          <p className="text-sm text-muted-foreground mt-1">Adjust filters above.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((o) => (
            <li key={o.id}>
              <Link to={`/education/manage/${o.id}`} className="block rounded-2xl border border-border bg-card p-4 hover:shadow-brand-2 transition">
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="font-semibold text-dark-blue">{o.title || <em>Untitled</em>}</h3>
                  <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {o.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {o.type} · starts {new Date(o.startsAt).toLocaleDateString()} · {o.sessionCount} session{o.sessionCount === 1 ? "" : "s"}
                </p>
                {o.pendingApplications > 0 && (
                  <p className="text-xs text-accent-coral mt-1">
                    {o.pendingApplications} application{o.pendingApplications === 1 ? "" : "s"} waiting on review
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
