import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/education.manage.sessions.$sessionId.attendance";
import { requireAuth } from "~/lib/auth";
import { canManageOffering } from "~/education/lib/auth";
import { listSessionRoster } from "~/education/lib/attendance-data";
import { AttendanceRoster } from "~/education/components/AttendanceRoster";

export const meta: Route.MetaFunction = () => [{ title: "Attendance · Education" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const result = await listSessionRoster(params.sessionId);
  if (!result) throw new Response("Not found", { status: 404 });
  if (!(await canManageOffering(auth.user.sub, result.session.offeringId))) {
    throw new Response("Forbidden", { status: 403 });
  }

  return {
    session: {
      id: result.session.id,
      offeringId: result.session.offeringId,
      sequence: result.session.sequence,
      datetime: result.session.datetime.toISOString(),
    },
    roster: result.roster,
  };
}

export default function SessionAttendance() {
  const { session, roster } = useLoaderData<typeof loader>();
  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <div className="mb-4 flex items-center gap-3">
        <Link to={`/education/manage/${session.offeringId}`} className="text-xs text-muted-foreground hover:underline">
          ← Back to offering
        </Link>
      </div>
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-1">
        Session {session.sequence} attendance
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        {new Date(session.datetime).toLocaleString()}
      </p>
      {roster.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No approved enrollees yet.</p>
      ) : (
        <AttendanceRoster sessionId={session.id} initial={roster as any} />
      )}
    </div>
  );
}
