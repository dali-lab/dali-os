import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/education.manage.$id.assignments";
import { requireAuth } from "~/lib/auth";
import { canManageOffering } from "~/education/lib/auth";
import { prisma } from "~/lib/db";
import { AssignmentBuilder } from "~/education/components/AssignmentBuilder";

export const meta: Route.MetaFunction = () => [{ title: "Assignments · Education" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await canManageOffering(auth.user.sub, params.id))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: { id: true, title: true },
  });
  if (!offering) throw new Response("Not found", { status: 404 });

  const assignments = await prisma.educationAssignment.findMany({
    where: { offeringId: params.id },
    orderBy: [{ dueAt: "asc" }],
    include: { _count: { select: { submissions: true } } },
  });

  return {
    offering,
    assignments: assignments.map((a) => ({
      id: a.id,
      title: a.title,
      submissionType: a.submissionType,
      dueAt: a.dueAt ? a.dueAt.toISOString() : null,
      submissionCount: a._count.submissions,
      instructionsDocId: a.instructionsDocId,
    })),
  };
}

export default function ManageAssignments() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <div className="mb-4 flex items-center gap-3">
        <Link to={`/education/manage/${data.offering.id}`} className="text-xs text-muted-foreground hover:underline">
          ← Back to offering
        </Link>
      </div>
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-1">{data.offering.title}</h1>
      <p className="text-sm text-muted-foreground mb-6">Assignments</p>
      <AssignmentBuilder offeringId={data.offering.id} assignments={data.assignments as any} />
    </div>
  );
}
