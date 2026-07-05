import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/education.enrolled.$id.assignments";
import { requireEnrollment } from "~/education/lib/auth";
import { prisma } from "~/lib/db";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireEnrollment(request, params.id);

  const assignments = await prisma.educationAssignment.findMany({
    where: { offeringId: params.id },
    orderBy: { dueAt: "asc" },
    select: { id: true, title: true, dueAt: true, submissionType: true },
  });

  return {
    offeringId: params.id,
    assignments: assignments.map((a) => ({
      ...a,
      dueAt: a.dueAt ? a.dueAt.toISOString() : null,
    })),
  };
}

export default function EnrolledAssignments() {
  const { assignments, offeringId } = useLoaderData<typeof loader>();
  return (
    <div>
      <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
        Assignments
      </h2>
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No assignments yet.</p>
      ) : (
        <ul className="space-y-2">
          {assignments.map((a) => (
            <li key={a.id}>
              <Link
                to={`/education/enrolled/${offeringId}/assignments/${a.id}`}
                className="block rounded-2xl border border-border bg-card p-4 hover:shadow-brand-2 transition"
              >
                <p className="font-semibold text-dark-blue">{a.title}</p>
                {a.dueAt && (
                  <p className="text-xs text-muted-foreground">
                    Due {new Date(a.dueAt).toLocaleString()}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
