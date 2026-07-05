import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education.$id.enrolled.grades";
import { requirePortalEnrollment } from "~/education/lib/auth";
import { prisma } from "~/lib/db";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requirePortalEnrollment(request, params.id);

  const assignments = await prisma.educationAssignment.findMany({
    where: { offeringId: params.id },
    orderBy: { dueAt: "asc" },
    select: { id: true, title: true, dueAt: true, submissionType: true },
  });

  const submissions = await prisma.educationSubmission.findMany({
    where: {
      assignmentId: { in: assignments.map((a) => a.id) },
      studentId: user.sub,
    },
    select: {
      assignmentId: true,
      submittedAt: true,
      gradedAt: true,
      files: true,
    },
  });

  const submissionByAssignment = new Map(
    submissions.map((s) => [s.assignmentId, s]),
  );

  return {
    offeringId: params.id,
    grades: assignments.map((a) => {
      const sub = submissionByAssignment.get(a.id);
      const files = (sub?.files ?? {}) as {
        feedback?: { body: string; at: string };
      };
      return {
        assignmentId: a.id,
        title: a.title,
        dueAt: a.dueAt ? a.dueAt.toISOString() : null,
        submittedAt: sub?.submittedAt ? sub.submittedAt.toISOString() : null,
        gradedAt: sub?.gradedAt ? sub.gradedAt.toISOString() : null,
        feedback: files.feedback ?? null,
      };
    }),
  };
}

export default function PortalEnrolledGrades() {
  const { grades, offeringId } = useLoaderData<typeof loader>();
  return (
    <div>
      <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
        Grades
      </h2>
      {grades.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No assignments yet.</p>
      ) : (
        <ul className="space-y-3">
          {grades.map((g) => (
            <li
              key={g.assignmentId}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to={`/portal/education/${offeringId}/assignments/${g.assignmentId}`}
                    className="font-semibold text-dark-blue hover:underline"
                  >
                    {g.title}
                  </Link>
                  {g.dueAt && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Due {new Date(g.dueAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {g.gradedAt ? (
                    <span className="inline-block px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                      Graded
                    </span>
                  ) : g.submittedAt ? (
                    <span className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                      Submitted
                    </span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
                      Not submitted
                    </span>
                  )}
                </div>
              </div>
              {g.feedback && (
                <div className="mt-3 rounded-xl bg-accent-teal/10 border border-accent-teal/20 px-3 py-2 text-sm">
                  <p className="text-xs font-semibold text-accent-teal mb-1">Feedback</p>
                  <p className="text-dark-blue/80">{g.feedback.body}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
