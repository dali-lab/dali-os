import { redirect } from "react-router";
import { useLoaderData, useActionData } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.setup";
import { requireOfferingManager } from "~/education/lib/access.server";
import { getUserRoles, isCore } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getOfferingDetail } from "~/education/lib/offerings.server";
import { runManageAction } from "~/education/lib/manage-actions.server";
import { requireAuth } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";
import { prisma } from "~/lib/db";
import { builtinDecisionEmail } from "~/education/lib/notifications.server";
import {
  listFeedbackResults,
  SESSION_FEEDBACK_SLOT,
  INSTRUCTOR_EXIT_SLOT,
} from "~/education/lib/feedback.server";
import { SetupPane } from "~/education/components/v2/SetupPane";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `Setup · ${data?.offering?.title ?? "Course"} · DALI` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const authOrRedirect = await requireOfferingManager(request, params.offeringId!);
  if (!authOrRedirect.ok) {
    return redirect(`/portal/education/${params.offeringId}`);
  }

  const roles = await getUserRoles(authOrRedirect.auth.user.sub, request);
  const redesign = await isFeatureEnabled(
    "education-redesign",
    authOrRedirect.auth.user.sub,
    roles,
    request,
  );
  if (!redesign) {
    return redirect(`/portal/education/${params.offeringId}/hub`);
  }

  const offering = await getOfferingDetail(params.offeringId!);
  if (!offering) throw new Response("Not found", { status: 404 });

  const core = await isCore(authOrRedirect.auth.user.sub);

  const [
    emailTemplates,
    decisionEmailBindings,
    publishedForms,
    feedbackBindings,
    instructorCandidates,
    memberInstructorRows,
    externalInstructorRows,
  ] = await Promise.all([
    prisma.emailTemplate.findMany({
      select: {
        id: true,
        name: true,
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
          select: { id: true, versionNumber: true, subject: true, body: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.educationDecisionEmail.findMany({
      where: { offeringId: params.offeringId! },
      select: { status: true, emailTemplateVersionId: true },
    }),
    prisma.form.findMany({
      where: { published: true, publicToken: { not: null } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.educationFormBinding.findMany({
      where: { offeringId: params.offeringId! },
      select: { slot: true, formId: true },
    }),
    core
      ? prisma.user.findMany({
          where: { daliMember: { isNot: null } },
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        })
      : Promise.resolve([]),
    core
      ? prisma.instructorAssignment.findMany({
          where: {
            offeringId: params.offeringId!,
            user: { daliMember: { isNot: null } },
          },
          select: { userId: true },
        })
      : Promise.resolve([]),
    core
      ? prisma.instructorAssignment.findMany({
          where: {
            offeringId: params.offeringId!,
            user: { daliMember: { is: null } },
          },
          select: {
            userId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const firstSessionId = offering.sessions[0]?.id ?? null;
  const [sessionFeedback, exitFeedback] = await Promise.all([
    firstSessionId
      ? listFeedbackResults({
          offeringId: params.offeringId!,
          slot: SESSION_FEEDBACK_SLOT,
          sessionId: firstSessionId,
          includeIdentities: core,
        })
      : Promise.resolve(null),
    core
      ? listFeedbackResults({
          offeringId: params.offeringId!,
          slot: INSTRUCTOR_EXIT_SLOT,
          includeIdentities: true,
        })
      : Promise.resolve(null),
  ]);

  const memberInstructorIds = [
    ...new Set(memberInstructorRows.map((r) => r.userId)),
  ];
  const externalInstructors = Array.from(
    new Map(
      externalInstructorRows.map((r) => [
        r.userId,
        {
          userId: r.userId,
          name: `${r.user.firstName} ${r.user.lastName}`.trim(),
        },
      ]),
    ).values(),
  );

  return {
    offering,
    emailTemplates: emailTemplates
      .filter((t) => t.versions.length > 0)
      .map((t) => ({
        name: t.name,
        versionId: t.versions[0]!.id,
        subject: t.versions[0]!.subject,
        body: t.versions[0]!.body,
      })),
    decisionEmailBindings,
    builtinDecisionCopy: {
      Approved: builtinDecisionEmail("Approved", offering.title),
      Waitlisted: builtinDecisionEmail("Waitlisted", offering.title),
      Rejected: builtinDecisionEmail("Rejected", offering.title),
    },
    publishedForms,
    feedbackBindings,
    sessionFeedback,
    exitFeedback,
    isCore: core,
    instructorCandidates: instructorCandidates.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
    })),
    memberInstructorIds,
    externalInstructors,
    collabToken: parseSessionCookie(request),
    userName: `${authOrRedirect.auth.user.firstName ?? ""} ${authOrRedirect.auth.user.lastName ?? ""}`.trim(),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const formData = await request.formData();

  const result = await runManageAction(formData, {
    offeringId: params.offeringId!,
    actorId: auth.user.sub,
  });
  if (result instanceof Response) return result;
  if (formData.get("intent") === "delete-offering")
    return redirect("/portal/education");
  if (
    formData.get("intent") === "duplicate-offering" &&
    "id" in (result as object) &&
    (result as { id?: string }).id
  )
    return redirect(`/portal/education/${(result as { id: string }).id}/hub`);
  return result;
}

export default function PortalSetupPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<{
    error?: string;
    closeOut?: { issued: number; alreadyIssued: number; ineligible: number };
  }>();

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      <SetupPane
        offeringId={data.offering.id}
        basePath={`/portal/education/${data.offering.id}`}
        offering={data.offering}
        emailTemplates={data.emailTemplates}
        decisionEmailBindings={data.decisionEmailBindings}
        builtinDecisionCopy={data.builtinDecisionCopy}
        publishedForms={data.publishedForms}
        feedbackBindings={data.feedbackBindings}
        sessionFeedback={data.sessionFeedback}
        exitFeedback={data.exitFeedback}
        isCore={data.isCore}
        instructorCandidates={data.instructorCandidates}
        memberInstructorIds={data.memberInstructorIds}
        externalInstructors={data.externalInstructors}
        collabToken={data.collabToken}
        userName={data.userName}
        actionError={actionData?.error}
        closeOutResult={actionData?.closeOut}
      />
    </div>
  );
}
