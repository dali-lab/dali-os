import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education.$id.enrolled";
import { requireAuth } from "~/lib/auth";
import { getApplicationForUser } from "~/education/lib/applications-data";
import { listDiscussionThreads } from "~/education/lib/discussions-data";
import { listMyAttendance } from "~/education/lib/attendance-data";
import { SessionList } from "~/education/components/SessionList";
import { AnnouncementsFeed } from "~/education/components/AnnouncementsFeed";
import { DiscussionThread } from "~/education/components/DiscussionThread";
import { WithdrawButton } from "~/education/components/WithdrawButton";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data && "offering" in data ? `${(data as any).offering.title} · Enrolled` : "Enrolled · DALI Education" },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const app = await getApplicationForUser(auth.user.sub, params.id);
  if (!app || app.status !== "Approved") {
    return redirect(`/portal/education/${params.id}`);
  }
  const [discussions, attendance] = await Promise.all([
    listDiscussionThreads(params.id, auth.user.sub),
    listMyAttendance(auth.user.sub, params.id),
  ]);
  return {
    offering: serialize(app.offering as any),
    applicationId: app.id,
    discussions,
    viewerUserId: auth.user.sub,
    myAttendance: attendance.map((a) => ({ sessionSequence: a.session.sequence, status: a.status })),
  };
}

export default function PortalEnrolled() {
  const { offering, applicationId, discussions, viewerUserId, myAttendance } = useLoaderData<typeof loader>();
  return (
    <div className="px-6 md:px-16 lg:px-24 py-10 max-w-3xl mx-auto">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wider text-accent-teal mb-1">{offering.type}</p>
        <h1 className="font-heading text-2xl font-bold text-dark-blue">{offering.title}</h1>
      </header>
      <section className="mb-8">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">Sessions</h2>
        <SessionList sessions={offering.sessions} />
        {myAttendance.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Your attendance:</span>
            {myAttendance.map((a) => (
              <span
                key={a.sessionSequence}
                className={`px-2 py-0.5 rounded-full ${
                  a.status === "Present" ? "bg-green-100 text-green-700"
                  : a.status === "Excused" ? "bg-yellow-100 text-yellow-800"
                  : "bg-red-100 text-red-700"
                }`}
              >
                S{a.sessionSequence}: {a.status}
              </span>
            ))}
          </div>
        )}
      </section>
      <section className="mb-8">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">Announcements</h2>
        <AnnouncementsFeed items={offering.announcements} />
      </section>
      <section className="mb-8">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">Discussion</h2>
        <DiscussionThread offeringId={offering.id} viewerUserId={viewerUserId} posts={discussions as any} />
      </section>
      <section>
        <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">Assignments</h2>
        {offering.assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No assignments yet.</p>
        ) : (
          <ul className="space-y-2">
            {offering.assignments.map((a: any) => (
              <li key={a.id}>
                <Link
                  to={`/portal/education/${offering.id}/assignments/${a.id}`}
                  className="block rounded-2xl border border-border bg-card p-4 hover:shadow-brand-2 transition"
                >
                  <p className="font-semibold text-dark-blue">{a.title}</p>
                  {a.dueAt && <p className="text-xs text-muted-foreground">Due {new Date(a.dueAt).toLocaleString()}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12 pt-6 border-t border-border">
        <WithdrawButton applicationId={applicationId} catalogHref="/portal/education" />
      </section>
    </div>
  );
}

function serialize(o: any) {
  return {
    id: o.id,
    title: o.title,
    type: o.type,
    sessions: o.sessions.map((s: any) => ({ ...s, datetime: s.datetime.toISOString() })),
    announcements: o.announcements.map((a: any) => ({ ...a, sentAt: a.sentAt.toISOString() })),
    assignments: o.assignments.map((a: any) => ({ ...a, dueAt: a.dueAt ? a.dueAt.toISOString() : null })),
  };
}
