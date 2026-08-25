import { useLoaderData } from "react-router";
import type { Route } from "./+types/education.$offeringId.assignments.$assignmentId";
import { requireEnrollment } from "~/education/lib/access.server";
import {
  getAssignmentForStudent,
  submitAssignment,
  ensureDocSubmissionRow,
} from "~/education/lib/assignments.server";
import { readDocAsBlocks } from "~/collab/read";
import { AssignmentWorkArea } from "~/education/components/AssignmentWorkArea";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { prisma } from "~/lib/db";
import { parseSessionCookie } from "~/lib/cookies";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.assignment.title ?? "Assignment"} · DALI OS` },
];

export const handle = {
  // Flat routes drop the opaque middle :offeringId, so the course would vanish
  // from the trail — declare the full trail back to the offering's assignments.
  breadcrumbTrail: (
    data:
      | {
          offeringId: string
          offeringTitle: string
          assignment: { title: string }
        }
      | undefined,
  ) => {
    if (!data) return null;
    const hub = `/education/${data.offeringId}/hub`;
    return [
      { label: "Education", to: "/education" },
      { label: data.offeringTitle, to: hub },
      { label: "Assignments", to: `${hub}?tab=assignments` },
      { label: data.assignment.title },
    ];
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth, applicationId, isManager } = await requireEnrollment(
    request,
    params.offeringId!,
    "member",
  );
  const result = await getAssignmentForStudent({
    assignmentId: params.assignmentId!,
    offeringId: params.offeringId!,
    studentId: auth.user.sub,
  });
  if (!result) throw new Response("Not found", { status: 404 });

  // For Doc-type assignments, ensure a submission row exists with contentDocId
  // set so the collab editor has a room to bind to before the student submits.
  if (
    result.assignment.submissionType === "Doc" &&
    applicationId !== null &&
    !result.submission?.contentDocId
  ) {
    await ensureDocSubmissionRow({
      assignmentId: params.assignmentId!,
      studentId: auth.user.sub,
      applicationId,
    });
    // Re-fetch after upsert so contentDocId is present in the returned data.
    const refreshed = await getAssignmentForStudent({
      assignmentId: params.assignmentId!,
      offeringId: params.offeringId!,
      studentId: auth.user.sub,
    });
    if (refreshed) result.submission = refreshed.submission;
  }

  const instructionsContent = result.assignment.instructionsDocId
    ? await readDocAsBlocks(result.assignment.instructionsDocId)
    : null;

  // Feedback is authored in a collab doc the student can't connect to; read
  // the released blocks server-side once graded so they render read-only.
  const feedbackContent =
    result.submission?.gradedAt != null
      ? await readDocAsBlocks(`edusubmission:${result.submission.id}:feedback`)
      : null;

  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.offeringId! },
    select: { title: true },
  });

  return {
    offeringId: params.offeringId!,
    offeringTitle: offering?.title ?? "Offering",
    assignment: { ...result.assignment, instructionsContent },
    submission: result.submission
      ? {
          ...result.submission,
          files: (result.submission.files as { key: string; name: string }[]) ?? [],
          feedbackContent,
        }
      : null,
    canSubmit: applicationId !== null,
    isManager,
    collabToken: parseSessionCookie(request),
    userName: `${auth.user.firstName ?? ""} ${auth.user.lastName ?? ""}`.trim(),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { auth, applicationId } = await requireEnrollment(
    request,
    params.offeringId!,
    "member",
  );
  if (!applicationId)
    return Response.json(
      { error: "Manager preview can't submit assignments." },
      { status: 403 },
    );
  const formData = await request.formData();
  let files: { key: string; name: string }[] = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("files") ?? "[]"));
    if (Array.isArray(parsed)) {
      files = parsed.filter(
        (f): f is { key: string; name: string } =>
          !!f && typeof f === "object" && typeof (f as { key?: unknown }).key === "string",
      );
    }
  } catch {
    return Response.json({ error: "Invalid file list." }, { status: 400 });
  }
  const result = await submitAssignment({
    assignmentId: params.assignmentId!,
    offeringId: params.offeringId!,
    studentId: auth.user.sub,
    applicationId,
    textContent: String(formData.get("textContent") ?? ""),
    files,
    link: String(formData.get("link") ?? ""),
  });
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return { ok: true };
}

export default function MemberAssignment() {
  const { assignment, submission, canSubmit, collabToken, userName } =
    useLoaderData<typeof loader>();
  const tz = useUserTimeZone();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {assignment.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {assignment.dueAt ? `Due ${formatDateTime(assignment.dueAt, tz)}` : "No due date"}
        </p>
      </header>
      <AssignmentWorkArea
        assignment={assignment}
        submission={submission}
        canSubmit={canSubmit}
        collabToken={collabToken}
        userName={userName}
      />
    </div>
  );
}
