import { redirect, useLoaderData, Form, Link } from "react-router";
import type { Route } from "./+types/education.manage.assignments.$assignmentId";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import {
  requireOfferingManager,
  redirectDartmouthToPortal,
} from "~/education/lib/access.server";
import {
  offeringIdForAssignment,
  listSubmissions,
  gradeSubmission,
} from "~/education/lib/assignments.server";
import { Button } from "~/components/ui/Button";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `Grade ${data?.assignment.title ?? "Assignment"} · DALI OS` },
];

export const handle = {
  breadcrumb: (data: { assignment: { title: string } } | undefined) =>
    data?.assignment.title ?? "Assignment",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectDartmouthToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const offeringId = await offeringIdForAssignment(params.assignmentId!);
  if (!offeringId) throw new Response("Not found", { status: 404 });
  const gate = await requireOfferingManager(request, offeringId);
  if (!gate.ok) return redirect("/education");

  const [assignment, submissions] = await Promise.all([
    prisma.educationAssignment.findUnique({
      where: { id: params.assignmentId },
      select: { id: true, title: true, dueAt: true, submissionType: true },
    }),
    listSubmissions(params.assignmentId!),
  ]);
  if (!assignment) throw new Response("Not found", { status: 404 });

  return {
    offeringId,
    assignment,
    submissions: submissions.map((s) => ({
      ...s,
      files: (s.files as { key: string; name: string }[]) ?? [],
    })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const offeringId = await offeringIdForAssignment(params.assignmentId!);
  if (!offeringId) return Response.json({ error: "Not found" }, { status: 404 });
  const gate = await requireOfferingManager(request, offeringId);
  if (!gate.ok) return gate.response;

  const formData = await request.formData();
  if (formData.get("intent") !== "grade-submission")
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  const result = await gradeSubmission({
    submissionId: String(formData.get("submissionId") ?? ""),
    offeringId,
    grade: String(formData.get("grade") ?? ""),
    feedbackText: String(formData.get("feedbackText") ?? ""),
    actorId: auth.user.sub,
  });
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return { ok: true };
}

export default function GradeAssignment() {
  const { offeringId, assignment, submissions } = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <header>
        <p className="text-xs text-muted-foreground">
          <Link
            to={`/education/manage/${offeringId}?tab=assignments`}
            className="hover:underline"
          >
            ← Assignments
          </Link>
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-foreground">
          {assignment.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {assignment.dueAt
            ? `Due ${formatDateTime(assignment.dueAt, tz)}`
            : "No due date"}
          {" · "}
          {submissions.length} submission{submissions.length === 1 ? "" : "s"}
        </p>
      </header>

      {submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No submissions yet.</p>
      ) : (
        submissions.map((s) => (
          <div key={s.id} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-foreground">
                {`${s.student.firstName} ${s.student.lastName}`.trim()}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.submittedAt ? `Submitted ${formatDateTime(s.submittedAt, tz)}` : "Not submitted"}
                {s.gradedAt ? ` · Graded ${formatDateTime(s.gradedAt, tz)}` : ""}
              </p>
            </div>

            {s.textContent && (
              <p className="mt-2 text-sm text-foreground whitespace-pre-wrap border-l-2 border-border pl-3">
                {s.textContent}
              </p>
            )}
            {s.files.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {s.files.map((f) => (
                  <li key={f.key}>
                    <a
                      href={`/api/upload/raw?key=${encodeURIComponent(f.key)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-accent-coral hover:underline"
                    >
                      {f.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}

            <Form
              method="post"
              className="mt-3 pt-3 border-t border-border grid gap-3 sm:grid-cols-[1fr_3fr_auto] items-end"
            >
              <input type="hidden" name="intent" value="grade-submission" />
              <input type="hidden" name="submissionId" value={s.id} />
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">Grade</span>
                <input
                  type="text"
                  name="grade"
                  defaultValue={s.grade ?? ""}
                  placeholder="Complete"
                  className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">
                  Feedback (shown to the student)
                </span>
                <textarea
                  name="feedbackText"
                  rows={2}
                  defaultValue={s.feedbackText ?? ""}
                  placeholder="Nice work — consider…"
                  className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                />
              </label>
              <Button type="submit" variant="secondary" size="sm">
                Save
              </Button>
            </Form>
          </div>
        ))
      )}
    </div>
  );
}
