import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/education";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { redirectDartmouthToPortal } from "~/education/lib/access.server";
import { listCatalog, listMyApplications } from "~/education/lib/offerings.server";
import { myCreditStanding } from "~/education/lib/ce-credits.server";
import { OfferingCard } from "~/education/components/OfferingCard";
import { educationPills } from "~/education/components/educationPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { Link } from "react-router";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [{ title: "Education · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectDartmouthToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const [offerings, myApplications, ceStanding, roles] = await Promise.all([
    listCatalog(auth.user.sub),
    listMyApplications(auth.user.sub),
    myCreditStanding(auth.user.sub),
    getUserRoles(auth.user.sub),
  ]);
  return {
    offerings,
    myApplications,
    ceStanding,
    canManage: roles.isCore || roles.isInstructor,
    isCore: roles.isCore,
  };
}

const APPLICATION_STATUS_STYLE: Record<string, string> = {
  Submitted: "bg-blue-100 text-blue-800",
  Approved: "bg-green-100 text-green-800",
  Waitlisted: "bg-amber-100 text-amber-800",
  Rejected: "bg-red-100 text-red-700",
  Withdrawn: "bg-muted text-muted-foreground",
};

export default function EducationCatalog() {
  const { offerings, myApplications, ceStanding, canManage, isCore } =
    useLoaderData<typeof loader>();
  const now = Date.now();
  const isPast = (o: { closedOutAt: string | Date | null; endsAt: string | Date }) =>
    o.closedOutAt != null || new Date(o.endsAt).getTime() < now;

  const enrolled = offerings.filter((o) => o.myStatus === "Approved" && !isPast(o));
  const upcoming = offerings.filter((o) => !isPast(o));
  const past = offerings.filter(isPast);

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

      {ceStanding && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            ceStanding.compliant
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {ceStanding.compliant ? (
            <>
              ✓ You&apos;ve earned your CE credit for {ceStanding.termCode} (
              {ceStanding.credits} this term).
            </>
          ) : (
            <>
              You need <strong>1 CE credit</strong> this term ({ceStanding.termCode})
              — you have {ceStanding.credits}. Attend a session to earn one.
            </>
          )}
        </div>
      )}

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
            Open &amp; upcoming
          </h2>
        )}
        {upcoming.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-8 text-center">
            <p className="font-heading font-semibold text-foreground">
              Nothing open right now
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Upcoming miniseries and workshops will show up here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((o) => (
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

      {past.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Past offerings ({past.length})
          </summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 opacity-80">
            {past.map((o) => (
              <OfferingCard
                key={o.id}
                offering={o}
                myStatus={o.myStatus}
                to={`/education/${o.id}`}
              />
            ))}
          </div>
        </details>
      )}

      {myApplications.length > 0 && (
        <section>
          <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Your applications
          </h2>
          <ul className="bg-card border border-border rounded-lg divide-y divide-border">
            {myApplications.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Link
                    to={`/education/${a.offeringId}`}
                    className="text-sm font-medium text-foreground hover:text-accent-coral truncate"
                  >
                    {a.offeringTitle}
                  </Link>
                  <p className="text-xs text-muted-foreground">{a.offeringType}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {a.certificateId && (
                    <Link
                      to={`/education/certificates/${a.certificateId}`}
                      className="text-xs font-semibold text-accent-coral hover:underline"
                    >
                      🎓 Certificate
                    </Link>
                  )}
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                      APPLICATION_STATUS_STYLE[a.status] ?? "bg-muted text-muted-foreground"
                    }`}
                  >
                    {a.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
