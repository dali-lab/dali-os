import { useLoaderData, Link } from "react-router";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { Route } from "./+types/education";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { redirectDartmouthToPortal } from "~/education/lib/access.server";
import { listMyApplications } from "~/education/lib/offerings.server";
import { getStudentDashboard } from "~/education/lib/lms.server";
import { myCreditStanding } from "~/education/lib/ce-credits.server";
import { StudentDashboard } from "~/education/components/StudentDashboard";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

export const meta: Route.MetaFunction = () => [{ title: "Education · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectDartmouthToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const [myApplications, ceStanding, dashboard] = await Promise.all([
    listMyApplications(auth.user.sub),
    myCreditStanding(auth.user.sub),
    getStudentDashboard(auth.user.sub),
  ]);
  return { myApplications, ceStanding, dashboard };
}

// An application's state is one quiet pill with a colored dot, not a tinted
// chip — the same shape the rest of the app uses for a status.
const DOT_TONE = {
  neutral: "bg-muted-foreground/50",
  success: "bg-accent-teal",
  warning: "bg-accent-yellow",
  danger: "bg-red-500",
} as const;

const APPLICATION_TONE: Record<string, keyof typeof DOT_TONE> = {
  Submitted: "success",
  Approved: "success",
  Waitlisted: "warning",
  Rejected: "danger",
  Withdrawn: "neutral",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          DOT_TONE[APPLICATION_TONE[status] ?? "neutral"],
        )}
      />
      {status}
    </span>
  );
}

export default function EducationHub() {
  const { myApplications, ceStanding, dashboard } = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();

  return (
    <div className="flex flex-col gap-6">
      {/* The CE standing belongs to the header, not to the page body — grouped
          tightly so it reads as a line under the title rather than as the
          first section. */}
      <div className="flex flex-col gap-3">
        <header>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Education
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your courses, work, and applications.
          </p>
        </header>

        {ceStanding && (
          // One quiet strip, not a card: the standing is a single fact, and a
          // tile-and-heading block that size read as a second page header.
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-card px-4 py-3">
            {ceStanding.compliant ? (
              <CircleCheck className="h-4 w-4 shrink-0 text-accent-teal" />
            ) : (
              <CircleAlert className="h-4 w-4 shrink-0 text-accent-yellow" />
            )}
            <span className="font-heading text-sm font-semibold text-foreground">
              CE credit
            </span>
            <span className="text-sm text-muted-foreground">
              {ceStanding.compliant
                ? `${ceStanding.credits} credit${ceStanding.credits === 1 ? "" : "s"} earned for ${ceStanding.termCode}.`
                : `You have ${ceStanding.credits} of 1 credit for ${ceStanding.termCode}. Attend a session to earn one.`}
            </span>
          </div>
        )}
      </div>

      <StudentDashboard
        dashboard={dashboard}
        tz={tz}
        paths={{
          course: (id) => `/education/${id}/hub`,
          checkIn: (sessionId) => `/education/check-in/${sessionId}`,
          assignment: (offeringId, assignmentId) =>
            `/education/${offeringId}/assignments/${assignmentId}`,
        }}
      />

      {dashboard.myCourses.length === 0 && myApplications.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-heading font-semibold text-foreground">
            You&apos;re not in a course yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse the offerings to apply or RSVP.
          </p>
          <Link
            to="/education/offerings"
            className={cn(buttonClasses("primary", "sm"), "mt-4 inline-flex")}
          >
            Browse offerings
          </Link>
        </div>
      )}

      {myApplications.length > 0 && (
        <section>
          <h2 className="mb-2 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your applications
          </h2>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {myApplications.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Link
                    to={`/education/${a.offeringId}`}
                    className="truncate text-sm font-medium text-foreground hover:text-accent-coral"
                  >
                    {a.offeringTitle}
                  </Link>
                  <p className="text-xs text-muted-foreground">{a.offeringType}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.certificateId && (
                    <Link
                      to={`/education/certificates/${a.certificateId}`}
                      className="text-xs font-semibold text-accent-coral hover:underline"
                    >
                      Certificate
                    </Link>
                  )}
                  <StatusPill status={a.status} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
