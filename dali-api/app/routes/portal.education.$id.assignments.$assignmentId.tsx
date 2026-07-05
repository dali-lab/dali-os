import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education.$id.assignments.$assignmentId";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { getAssignmentWithMySubmission } from "~/education/lib/assignments-data";
import { SubmissionForm } from "~/education/components/SubmissionForm";

export const handle = {
  breadcrumb: (data: any) => data?.assignment?.title,
};

export const meta: Route.MetaFunction = () => [{ title: "Assignment · DALI Education" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const application = await prisma.educationApplication.findUnique({
    where: {
      applicantUserId_offeringId: {
        applicantUserId: auth.user.sub,
        offeringId: params.id,
      },
    },
    select: { status: true },
  });
  if (!application || application.status !== "Approved") {
    return redirect(`/portal/education/${params.id}`);
  }

  const { assignment, submission } = await getAssignmentWithMySubmission(
    params.assignmentId,
    auth.user.sub,
  );
  if (!assignment || assignment.offering?.id !== params.id) {
    throw new Response("Not found", { status: 404 });
  }

  const payload = (submission?.files ?? {}) as {
    body?: string;
    attachments?: { key: string; name: string; contentType: string; size: number }[];
    feedback?: { body: string; at: string };
  };

  return {
    assignment: {
      id: assignment.id,
      title: assignment.title,
      submissionType: assignment.submissionType,
      dueAt: assignment.dueAt ? assignment.dueAt.toISOString() : null,
      offering: assignment.offering,
    },
    submission: {
      body: payload.body ?? "",
      attachments: payload.attachments ?? [],
      submittedAt: submission?.submittedAt ? submission.submittedAt.toISOString() : null,
      gradedAt: submission?.gradedAt ? submission.gradedAt.toISOString() : null,
      feedback: payload.feedback ?? null,
    },
    backHref: `/portal/education/${params.id}/enrolled`,
  };
}

export default function PortalAssignmentDetail() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="px-6 md:px-16 lg:px-24 py-10 max-w-3xl mx-auto">
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-1">{data.assignment.title}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {data.assignment.offering?.title} · {data.assignment.submissionType} ·{" "}
        {data.assignment.dueAt ? `Due ${new Date(data.assignment.dueAt).toLocaleString()}` : "No due date"}
      </p>
      <SubmissionForm
        assignmentId={data.assignment.id}
        submissionType={data.assignment.submissionType}
        initialBody={data.submission.body}
        initialAttachments={data.submission.attachments}
        alreadySubmittedAt={data.submission.submittedAt}
        gradedAt={data.submission.gradedAt}
        feedback={data.submission.feedback}
      />
    </div>
  );
}
