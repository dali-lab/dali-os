import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/education.manage.assignments.$assignmentId";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canManageOffering } from "~/education/lib/auth";
import { listSubmissionsForAssignment } from "~/education/lib/assignments-data";
import { GradePanel } from "~/education/components/GradePanel";

export const meta: Route.MetaFunction = () => [{ title: "Submissions · Education" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const assignment = await prisma.educationAssignment.findUnique({
    where: { id: params.assignmentId },
    include: { offering: { select: { id: true, title: true } } },
  });
  if (!assignment || !assignment.offering) {
    throw new Response("Not found", { status: 404 });
  }
  if (!(await canManageOffering(auth.user.sub, assignment.offering.id))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const submissions = await listSubmissionsForAssignment(params.assignmentId);

  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      submissionType: assignment.submissionType,
      dueAt: assignment.dueAt ? assignment.dueAt.toISOString() : null,
      offering: assignment.offering,
    },
    submissions: submissions.map((s) => ({
      id: s.id,
      submittedAt: s.submittedAt ? s.submittedAt.toISOString() : null,
      gradedAt: s.gradedAt ? s.gradedAt.toISOString() : null,
      student: s.student,
      files: s.files as any,
    })),
  };
}

export default function AssignmentSubmissions() {
  const { assignment, submissions } = useLoaderData<typeof loader>();
  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <div className="mb-4 flex items-center gap-3">
        <Link to={`/education/manage/${assignment.offering.id}/assignments`} className="text-xs text-muted-foreground hover:underline">
          ← All assignments
        </Link>
      </div>
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-1">{assignment.title}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {assignment.offering.title} · {assignment.submissionType} ·{" "}
        {assignment.dueAt ? `Due ${new Date(assignment.dueAt).toLocaleString()}` : "No due date"}
      </p>

      {submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No submissions yet.</p>
      ) : (
        <ul className="space-y-3">
          {submissions.map((s) => {
            const payload = (s.files ?? {}) as {
              body?: string;
              attachments?: { key: string; name: string; size: number }[];
              feedback?: { body: string };
            };
            const name = `${s.student.firstName ?? ""} ${s.student.lastName ?? ""}`.trim() || s.student.netId || "Student";
            return (
              <li key={s.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="font-semibold text-dark-blue">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.submittedAt ? new Date(s.submittedAt).toLocaleString() : "Draft"}
                  </p>
                </div>
                {payload.body && (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap mb-2">{payload.body}</p>
                )}
                {payload.attachments && payload.attachments.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {payload.attachments.map((a, i) => (
                      <li key={i}>
                        <a
                          href={`/api/upload/url?key=${encodeURIComponent(a.key)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent-coral hover:underline"
                        >
                          {a.name} ({Math.round(a.size / 1024)} KB)
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <GradePanel
                  submissionId={s.id}
                  initialFeedback={payload.feedback?.body ?? ""}
                  initialGraded={!!s.gradedAt}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
