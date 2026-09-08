import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { listCatalog } from "~/education/lib/offerings.server";
import { getStudentDashboard } from "~/education/lib/lms.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { OfferingCard } from "~/education/components/OfferingCard";
import { StudentDashboard } from "~/education/components/StudentDashboard";
import { EducationHubV2 } from "~/education/components/v2/EducationHubV2";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

export const meta: Route.MetaFunction = () => [
  { title: "Education · DALI" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  // Lab members use the member-shell education surface instead.
  if (auth.user.type === "member") return redirect("/education");

  // Portal users carry no roles; pass the empty role object that getUserRoles
  // returns for a non-member — flag targeting that requires a role never fires.
  const [offerings, dashboard, roles] = await Promise.all([
    listCatalog(auth.user.sub),
    getStudentDashboard(auth.user.sub),
    getUserRoles(auth.user.sub),
  ]);
  const redesign = await isFeatureEnabled("education-redesign", auth.user.sub, roles, request);
  return { offerings, dashboard, redesign };
}

export default function PortalEducation() {
  const { offerings, dashboard, redesign } = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();
  // Enrolled courses show in the dashboard's "My courses"; the list below is
  // offerings still open to apply to or RSVP for.
  const now = Date.now();
  const isPast = (o: { closedOutAt: string | Date | null; endsAt: string | Date | null }) =>
    o.closedOutAt != null || (o.endsAt != null && new Date(o.endsAt).getTime() < now);
  const openOfferings = offerings.filter((o) => o.myStatus !== "Approved");
  const upcoming = openOfferings.filter((o) => !isPast(o));
  const past = offerings.filter(isPast);
  const hasCourses = dashboard.myCourses.some((c) => !c.isPast);

  if (redesign) {
    return (
      <div className="py-8 flex flex-col gap-8">
        <EducationHubV2
          basePath="/portal/education"
          ceStanding={null}
          dashboard={dashboard}
          upcoming={upcoming}
          past={past}
          canManage={false}
          isMemberShell={false}
        />
      </div>
    );
  }

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
