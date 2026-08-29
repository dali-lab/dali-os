import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { listCatalog } from "~/education/lib/offerings.server";
import { getStudentDashboard } from "~/education/lib/lms.server";
import { OfferingCard } from "~/education/components/OfferingCard";
import { StudentDashboard } from "~/education/components/StudentDashboard";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

export const meta: Route.MetaFunction = () => [
  { title: "Education · DALI" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  // Lab members use the member-shell education surface instead.
  if (auth.user.type === "member") return redirect("/education");

  const [offerings, dashboard] = await Promise.all([
    listCatalog(auth.user.sub),
    getStudentDashboard(auth.user.sub),
  ]);
  return { offerings, dashboard };
}

export default function PortalEducation() {
  const { offerings, dashboard } = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();
  // Enrolled courses show in the dashboard's "My courses"; the list below is
  // offerings still open to apply to or RSVP for.
  const openOfferings = offerings.filter((o) => o.myStatus !== "Approved");
  const hasCourses = dashboard.myCourses.some((c) => !c.isPast);

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

      <StudentDashboard
        dashboard={dashboard}
        tz={tz}
        paths={{
          course: (id) => `/portal/education/${id}/hub`,
          checkIn: (sessionId) => `/education/check-in/${sessionId}`,
          assignment: (offeringId, assignmentId) =>
            `/portal/education/${offeringId}/assignments/${assignmentId}`,
        }}
      />

      <section>
        {hasCourses && (
          <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            All offerings
          </h2>
        )}
        {openOfferings.length === 0 ? (
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
            {openOfferings.map((o) => (
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
