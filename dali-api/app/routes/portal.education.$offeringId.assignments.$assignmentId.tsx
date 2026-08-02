import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.assignments.$assignmentId";
import { requireEnrollment } from "~/education/lib/access.server";
import {
  getAssignmentForStudent,
  submitAssignment,
} from "~/education/lib/assignments.server";
import { collabDocToProseMirror } from "~/collab/export";
import { AssignmentWorkArea } from "~/education/components/AssignmentWorkArea";
import { formatDateTime } from "~/lib/display";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.assignment.title ?? "Assignment"} · DALI` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth, applicationId } = await requireEnrollment(
    request,
    params.offeringId!,
    "portal",
  );
  const result = await getAssignmentForStudent({
    assignmentId: params.assignmentId!,
    offeringId: params.offeringId!,
    studentId: auth.user.sub,
  });
  if (!result) throw new Response("Not found", { status: 404 });

  const instructionsContent = result.assignment.instructionsDocId
    ? await collabDocToProseMirror(result.assignment.instructionsDocId)
    : null;

  return {
    offeringId: params.offeringId!,
    assignment: { ...result.assignment, instructionsContent },
    submission: result.submission
      ? {
          ...result.submission,
          files: (result.submission.files as { key: string; name: string }[]) ?? [],
        }
      : null,
    canSubmit: applicationId !== null,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { auth, applicationId } = await requireEnrollment(
    request,
    params.offeringId!,
    "portal",
  );
  if (!applicationId)
    return Response.json({ error: "Not enrolled." }, { status: 403 });
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
  });
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return { ok: true };
}

export default function PortalAssignment() {
  const { offeringId, assignment, submission, canSubmit } =
    useLoaderData<typeof loader>();

  return (
    <div className="w-full px-4 sm:px-6 py-8 flex flex-col gap-4">
      <header>
        <p className="text-xs text-muted-foreground">
          <Link
            to={`/portal/education/${offeringId}/hub?tab=assignments`}
            className="hover:underline"
          >
            ← Assignments
          </Link>
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-dark-blue">
          {assignment.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {assignment.dueAt ? `Due ${formatDateTime(assignment.dueAt)}` : "No due date"}
        </p>
      </header>
      <AssignmentWorkArea
        assignment={assignment}
        submission={submission}
        canSubmit={canSubmit}
      />
    </div>
  );
}
