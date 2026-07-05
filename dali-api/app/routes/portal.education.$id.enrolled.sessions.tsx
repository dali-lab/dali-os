import { useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education.$id.enrolled.sessions";
import { requirePortalEnrollment } from "~/education/lib/auth";
import { prisma } from "~/lib/db";
import { listMyAttendance } from "~/education/lib/attendance-data";
import { SessionList } from "~/education/components/SessionList";
import { WithdrawButton } from "~/education/components/WithdrawButton";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, application } = await requirePortalEnrollment(request, params.id);

  const sessions = await prisma.educationSession.findMany({
    where: { offeringId: params.id },
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      datetime: true,
      location: true,
      recordingUrl: true,
      materialsDocId: true,
    },
  });

  const attendance = await listMyAttendance(user.sub, params.id);

  return {
    sessions: sessions.map((s) => ({ ...s, datetime: s.datetime.toISOString() })),
    myAttendance: attendance.map((a) => ({
      sessionSequence: a.session.sequence,
      status: a.status,
    })),
    applicationId: application.id,
  };
}

export default function PortalEnrolledSessions() {
  const { sessions, myAttendance, applicationId } = useLoaderData<typeof loader>();
  return (
    <div>
      <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
        Sessions
      </h2>
      <SessionList sessions={sessions} />
      {myAttendance.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Your attendance:</span>
          {myAttendance.map((a) => (
            <span
              key={a.sessionSequence}
              className={`px-2 py-0.5 rounded-full ${
                a.status === "Present"
                  ? "bg-green-100 text-green-700"
                  : a.status === "Excused"
                    ? "bg-yellow-100 text-yellow-800"
                    : "bg-red-100 text-red-700"
              }`}
            >
              S{a.sessionSequence}: {a.status}
            </span>
          ))}
        </div>
      )}
      <div className="mt-12 pt-6 border-t border-border">
        <WithdrawButton applicationId={applicationId} catalogHref="/portal/education" />
      </div>
    </div>
  );
}
