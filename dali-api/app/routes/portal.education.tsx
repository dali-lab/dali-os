import { redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/portal.education";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { listCatalog } from "~/education/lib/offerings.server";
import { getStudentDashboard } from "~/education/lib/lms.server";
import { OfferingCard } from "~/education/components/OfferingCard";
import { OfferingCatalog } from "~/education/components/OfferingCatalog";
import { StudentDashboard } from "~/education/components/StudentDashboard";
import { BookOpen, Compass } from "lucide-react";
import { PageTabRow } from "~/components/os-page";
import { useFeatureFlag } from "~/components/FeatureFlags";
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

type EducationTab = "courses" | "browse";
const TABS = [
  { key: "courses", label: "My courses", icon: BookOpen },
  { key: "browse", label: "Browse offerings", icon: Compass },
] as const;

export default function PortalEducation() {
  const { offerings, dashboard } = useLoaderData<typeof loader>();
  const redesign = useFeatureFlag("education-redesign-v2");
  const tz = useUserTimeZone();
  // Enrolled courses show in the dashboard's "My courses"; the list below is
  // offerings still open to apply to or RSVP for.
  const openOfferings = offerings.filter((o) => o.myStatus !== "Approved");
  const hasCourses = dashboard.myCourses.some((c) => !c.isPast);
  // My courses and the catalog are separate tabs. With nothing enrolled there
  // is nothing to show on the first, so the page opens on Browse.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: EducationTab =
    requested === "courses" || requested === "browse"
      ? requested
      : hasCourses
        ? "courses"
        : "browse";

  return (
    <div className="px-6 py-10 flex flex-col gap-8">
      <header>
        <h1 className="font-heading text-4xl font-medium text-foreground">
          Education at DALI
        </h1>
      </header>

      <PageTabRow
        label="Education sections"
        tabs={TABS.map((t) => ({
          label: t.label,
          icon: t.icon,
          active: tab === t.key,
          onClick: () => setSearchParams({ tab: t.key }, { replace: true }),
        }))}
      />

      {tab === "courses" &&
        (hasCourses || dashboard.openCheckIns.length > 0 || dashboard.dueSoon.length > 0 ? (
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
        ) : (
          <div className="bg-os-card rounded-os-card p-8 text-center">
            <p className="font-heading font-semibold text-foreground">
              You are not in a course yet
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Browse offerings to apply or RSVP.
            </p>
          </div>
        ))}

      {tab !== "browse" ? null : redesign ? (
        <OfferingCatalog
          offerings={offerings}
          to={(id) => `/portal/education/${id}`}
        />
      ) : (
        <section className="flex flex-col gap-3">
          {openOfferings.length === 0 ? (
            <div className="bg-os-card rounded-os-card p-8 text-center">
              <p className="font-heading font-semibold text-foreground">
                Nothing scheduled right now
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                New miniseries and workshops are posted here each term.
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
      )}
    </div>
  );
}
