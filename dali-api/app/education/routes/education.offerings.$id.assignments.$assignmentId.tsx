import { useLoaderData, Form, useNavigation } from "react-router";
import type { Route } from "./+types/education.offerings.$id.assignments.$assignmentId";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { EducationTabs } from "~/education/components/EducationTabs";

export async function loader({ request, params }: Route.LoaderArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: { id: true, title: true },
  });
  const assignment = await prisma.educationAssignment.findUnique({
    where: { id: params.assignmentId },
    include: {
      submissions: {
        include: {
          student: { select: { firstName: true, lastName: true } },
        },
        orderBy: { submittedAt: "desc" },
      },
    },
  });
  if (!offering || !assignment) {
    return new Response("Not found", { status: 404 });
  }
  return { offering, assignment };
}

export async function action({ request, params }: Route.ActionArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const fd = await request.formData();
  const submissionId = String(fd.get("submissionId"));
  await prisma.educationSubmission.update({
    where: { id: submissionId },
    data: { gradedAt: new Date() },
  });
  return null;
}

export default function AssignmentDetail() {
  const { offering, assignment } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  return (
    <div className="max-w-5xl mx-auto p-6">
      <EducationTabs offeringId={offering.id} offeringTitle={offering.title} />
      <h2 className="font-heading font-bold text-xl text-dark-blue mb-1">
        {assignment.title}
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        {assignment.submissionType} ·{" "}
        {assignment.dueAt
          ? `due ${new Date(assignment.dueAt).toLocaleString()}`
          : "no due date"}
      </p>
      <h3 className="font-heading text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2">
        Submissions ({assignment.submissions.length})
      </h3>
      <ul className="space-y-2">
        {assignment.submissions.map((s) => (
          <li
            key={s.id}
            className="bg-card border border-border rounded-md p-3 flex items-center justify-between text-sm"
          >
            <div>
              <p className="font-semibold text-dark-blue">
                {s.student.firstName} {s.student.lastName}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.submittedAt
                  ? `submitted ${new Date(s.submittedAt).toLocaleString()}`
                  : "in progress"}
                {s.gradedAt
                  ? ` · graded ${new Date(s.gradedAt).toLocaleDateString()}`
                  : ""}
              </p>
            </div>
            {s.submittedAt && !s.gradedAt && (
              <Form method="post">
                <input type="hidden" name="submissionId" value={s.id} />
                <button
                  type="submit"
                  disabled={nav.state !== "idle"}
                  className="px-2 py-1 bg-accent-coral text-white text-xs font-medium rounded"
                >
                  Mark graded
                </button>
              </Form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
