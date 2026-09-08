import { redirect } from "react-router";
import { useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.people";
import { requireOfferingManager } from "~/education/lib/access.server";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getOfferingDetail } from "~/education/lib/offerings.server";
import { listApplications } from "~/education/lib/apply.server";
import { notesForOffering } from "~/education/lib/student-notes.server";
import { getAttendanceMatrix } from "~/education/lib/attendance.server";
import {
  listAssignments,
  getPerformanceByApplication,
} from "~/education/lib/assignments.server";
import { certificateEligibility } from "~/education/lib/certificates.server";
import { runManageAction } from "~/education/lib/manage-actions.server";
import { requireAuth } from "~/lib/auth";
import { PeoplePane } from "~/education/components/v2/PeoplePane";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `People · ${data?.offeringTitle ?? "Course"} · DALI` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const authOrRedirect = await requireOfferingManager(request, params.offeringId!);
  if (!authOrRedirect.ok) {
    return redirect(`/portal/education/${params.offeringId}`);
  }

  const roles = await getUserRoles(authOrRedirect.auth.user.sub, request);
  const redesign = await isFeatureEnabled(
    "education-redesign",
    authOrRedirect.auth.user.sub,
    roles,
    request,
  );
  if (!redesign) {
    return redirect(`/portal/education/${params.offeringId}/hub`);
  }

  const offering = await getOfferingDetail(params.offeringId!);
  if (!offering) throw new Response("Not found", { status: 404 });

  const [applications, notes, attendanceMatrix, assignments] = await Promise.all([
    listApplications(params.offeringId!),
    notesForOffering(params.offeringId!),
    getAttendanceMatrix(params.offeringId!),
    listAssignments(params.offeringId!),
  ]);

  const performanceByApp = await getPerformanceByApplication(
    params.offeringId!,
    assignments.map((a) => a.id),
  );

  const completionByApp: Record<string, boolean> = Object.fromEntries(
    attendanceMatrix.students.map((st) => {
      const present = Object.values(st.marks).filter((m) => m === "Present").length;
      const excused = Object.values(st.marks).filter((m) => m === "Excused").length;
      return [
        st.applicationId,
        certificateEligibility({
          type: offering.type as "Miniseries" | "Workshop",
          totalSessions: attendanceMatrix.sessions.length,
          present,
          excused,
          threshold: offering.completionThreshold,
        }),
      ];
    }),
  );

  return {
    offeringId: params.offeringId!,
    offeringTitle: offering.title,
    applications: applications.map((a) => ({
      ...a,
      note: notes.get(a.id)
        ? {
            feedback: notes.get(a.id)!.feedback,
            internalNote: notes.get(a.id)!.internalNote,
          }
        : null,
    })),
    attendanceMatrix,
    assignmentsForPerformance: assignments.map((a) => ({
      id: a.id,
      title: a.title,
      points: a.points,
    })),
    submissionsByApp: performanceByApp,
    completionByApp,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const formData = await request.formData();
  const result = await runManageAction(formData, {
    offeringId: params.offeringId!,
    actorId: auth.user.sub,
  });
  if (result instanceof Response) return result;
  return result;
}

export default function PortalPeoplePage() {
  const {
    offeringId,
    applications,
    attendanceMatrix,
    assignmentsForPerformance,
    submissionsByApp,
    completionByApp,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ bulkApprove?: { approved: number; skipped: number } }>();

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <PeoplePane
        offeringId={offeringId}
        basePath={`/portal/education/${offeringId}`}
        applications={applications}
        attendanceMatrix={attendanceMatrix}
        assignmentsForPerformance={assignmentsForPerformance}
        submissionsByApp={submissionsByApp}
        completionByApp={completionByApp}
        bulkApproveResult={actionData?.bulkApprove}
      />
    </div>
  );
}
