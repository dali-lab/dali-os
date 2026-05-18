import { useLoaderData, Form, useNavigation } from "react-router";
import type { Route } from "./+types/portal.education.applications.$id.assignments.$assignmentId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const application = await prisma.educationApplication.findUnique({
    where: { id: params.id },
    select: { applicantUserId: true, offeringId: true, id: true },
  });
  if (!application || application.applicantUserId !== auth.user.sub) {
    return new Response("Not found", { status: 404 });
  }
  const assignment = await prisma.educationAssignment.findUnique({
    where: { id: params.assignmentId },
  });
  if (!assignment) return new Response("Not found", { status: 404 });

  const submission = await prisma.educationSubmission.findUnique({
    where: {
      assignmentId_studentId: {
        assignmentId: assignment.id,
        studentId: auth.user.sub,
      },
    },
  });
  return { application, assignment, submission };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const application = await prisma.educationApplication.findUnique({
    where: { id: params.id },
    select: { applicantUserId: true, status: true, id: true },
  });
  if (
    !application ||
    application.applicantUserId !== auth.user.sub ||
    application.status !== "Approved"
  ) {
    return new Response("Forbidden", { status: 403 });
  }
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "save");
  const submission = await prisma.educationSubmission.upsert({
    where: {
      assignmentId_studentId: {
        assignmentId: params.assignmentId!,
        studentId: auth.user.sub,
      },
    },
    create: {
      assignmentId: params.assignmentId!,
      studentId: auth.user.sub,
      educationApplicationId: application.id,
      submittedAt: intent === "submit" ? new Date() : null,
    },
    update: {
      ...(intent === "submit" ? { submittedAt: new Date() } : {}),
    },
  });
  return { submission };
}

export default function PortalSubmissionView() {
  const { assignment, submission } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-1">
        {assignment.title}
      </h1>
      <p className="text-sm text-muted-foreground mb-4">
        {assignment.submissionType}
        {assignment.dueAt
          ? ` · due ${new Date(assignment.dueAt).toLocaleString()}`
          : ""}
      </p>
      {submission?.submittedAt && (
        <p className="text-sm text-green-700 mb-4">
          Submitted {new Date(submission.submittedAt).toLocaleString()}.
        </p>
      )}
      <p className="text-sm text-muted-foreground mb-3">
        Submission body lives in the collaborative editor (configure with the
        page's <code>education-submission:{submission?.id ?? "<id>"}:content</code> doc).
      </p>
      <Form method="post" className="flex gap-2">
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={nav.state !== "idle"}
          className="px-3 py-1.5 bg-card border border-border text-sm font-medium rounded-md"
        >
          Save draft
        </button>
        <button
          type="submit"
          name="intent"
          value="submit"
          disabled={nav.state !== "idle"}
          className="px-3 py-1.5 bg-accent-coral text-white text-sm font-medium rounded-md"
        >
          Mark submitted
        </button>
      </Form>
    </div>
  );
}
