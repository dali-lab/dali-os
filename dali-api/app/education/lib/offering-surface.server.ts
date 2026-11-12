import { redirect } from "react-router";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { getOfferingDetail, registrationOpen } from "~/education/lib/offerings.server";
import { loadOfferingApplicationForm } from "~/education/lib/application-form.server";
import { submitApplication, getMyApplication } from "~/education/lib/apply.server";
import { prisma } from "~/lib/db.server";
import { getCollabToken } from "~/lib/collab-token.server";
import { readDocAsBlocks } from "~/collab/read";
import { requireEnrollment } from "~/education/lib/access.server";
import { readMaterialPage, getHubData } from "~/education/lib/lms.server";
import { withdrawApplication } from "~/education/lib/decisions.server";
import { runDiscussionAction } from "~/education/lib/discussions.server";
import { recordRouteVisit } from "~/lib/user-pages.server";
import {
  getAssignmentForStudent,
  submitAssignment,
  ensureDocSubmissionRow,
} from "~/education/lib/assignments.server";
import { sendsAway, type OfferingSurface } from "./offering-surface";

type OfferingArgs = { request: Request; params: { offeringId?: string } };
type AssignmentArgs = { request: Request; params: { offeringId?: string; assignmentId?: string } };
type PageArgs = { request: Request; params: { offeringId?: string; pageId?: string } };

export async function loadApply({ request, params }: OfferingArgs, surface: OfferingSurface) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (sendsAway(surface, auth.user.type)) {
    return redirect(`${surface.otherBase}/${params.offeringId}/apply`);
  }

  const offering = await getOfferingDetail(params.offeringId!);
  if (!offering || offering.status !== "Published")
    throw new Response("Not found", { status: 404 });

  const [form, myApplication] = await Promise.all([
    loadOfferingApplicationForm(offering.id, auth.user.sub),
    getMyApplication(auth.user.sub, offering.id),
  ]);

  const decided =
    myApplication &&
    (myApplication.status === "Approved" ||
      myApplication.status === "Waitlisted" ||
      myApplication.status === "Rejected");

  return {
    offering: {
      id: offering.id,
      title: offering.title,
      type: offering.type,
      requiresReview: offering.requiresReview,
    },
    open: registrationOpen(offering) && !decided && form !== null,
    myStatus: myApplication?.status ?? null,
    questions: form?.questions ?? [],
    versionUpdatedAt: form?.versionUpdatedAt,
    description: ensureBlocks(form?.description ?? null),
    defaultAnswers:
      myApplication?.status === "Submitted"
        ? ((myApplication.formSubmission?.answers ?? {}) as Record<string, string>)
        : undefined,
  };
}

export async function submitApplyAction({ request, params }: OfferingArgs, surface: OfferingSurface) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  let answers: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(String(formData.get("answers") ?? ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("bad shape");
    answers = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid submission." }, { status: 400 });
  }

  const result = await submitApplication({
    offeringId: params.offeringId!,
    userId: auth.user.sub,
    answers,
    versionUpdatedAt: (formData.get("versionUpdatedAt") as string) || undefined,
  });
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return redirect(`${surface.base}/${params.offeringId}`);
}

export async function loadAssignment({ request, params }: AssignmentArgs, surface: OfferingSurface) {
  const { auth, applicationId, isManager } = await requireEnrollment(
    request,
    params.offeringId!,
    surface.kind,
  );
  const result = await getAssignmentForStudent({
    assignmentId: params.assignmentId!,
    offeringId: params.offeringId!,
    studentId: auth.user.sub,
  });
  if (!result) throw new Response("Not found", { status: 404 });

  // For Doc-type assignments, ensure a submission row exists with contentDocId
  // set so the collab editor has a room to bind to before the student submits.
  if (
    result.assignment.submissionType === "Doc" &&
    applicationId !== null &&
    !result.submission?.contentDocId
  ) {
    await ensureDocSubmissionRow({
      assignmentId: params.assignmentId!,
      studentId: auth.user.sub,
      applicationId,
    });
    // Re-fetch after upsert so contentDocId is present in the returned data.
    const refreshed = await getAssignmentForStudent({
      assignmentId: params.assignmentId!,
      offeringId: params.offeringId!,
      studentId: auth.user.sub,
    });
    if (refreshed) result.submission = refreshed.submission;
  }

  const instructionsContent = result.assignment.instructionsDocId
    ? await readDocAsBlocks(result.assignment.instructionsDocId)
    : null;

  // Feedback is authored in a collab doc the student can't connect to; read
  // the released blocks server-side once graded so they render read-only.
  const feedbackContent =
    result.submission?.gradedAt != null
      ? await readDocAsBlocks(`edusubmission:${result.submission.id}:feedback`)
      : null;

  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.offeringId! },
    select: { title: true },
  });

  return {
    offeringId: params.offeringId!,
    offeringTitle: offering?.title ?? "Offering",
    assignment: { ...result.assignment, instructionsContent },
    submission: result.submission
      ? {
          ...result.submission,
          files: (result.submission.files as { key: string; name: string }[]) ?? [],
          feedbackContent,
        }
      : null,
    canSubmit: applicationId !== null,
    isManager,
    collabToken: await getCollabToken(request),
    userName: `${auth.user.firstName ?? ""} ${auth.user.lastName ?? ""}`.trim(),
  };
}

export async function submitAssignmentAction({ request, params }: AssignmentArgs, surface: OfferingSurface) {
  const { auth, applicationId } = await requireEnrollment(
    request,
    params.offeringId!,
    surface.kind,
  );
  if (!applicationId)
    return Response.json(
      { error: surface.kind === "member" ? "Manager preview can't submit assignments." : "Not enrolled." },
      { status: 403 },
    );
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
    link: String(formData.get("link") ?? ""),
  });
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return { ok: true };
}


export async function loadMaterialPage({ request, params }: PageArgs, surface: OfferingSurface) {
  const { auth, isManager } = await requireEnrollment(
    request,
    params.offeringId!,
    surface.kind,
  );
  const page = await readMaterialPage(params.offeringId!, params.pageId!, { skipShared: true });
  if (!page) throw new Response("Not found", { status: 404 });
  const [offering, me] = await Promise.all([
    prisma.educationOffering.findUnique({
      where: { id: params.offeringId! },
      select: { title: true },
    }),
    // Only the shared-doc (co-edit) path needs the author's display name.
    page.studentEditable
      ? prisma.user.findUnique({
          where: { id: auth.user.sub },
          select: { firstName: true, lastName: true },
        })
      : Promise.resolve(null),
  ]);
  return {
    offeringId: params.offeringId!,
    offeringTitle: offering?.title ?? "Offering",
    page: {
      id: page.id,
      title: page.title,
      studentEditable: page.studentEditable,
      content: page.content,
    },
    collabToken: page.studentEditable ? await getCollabToken(request) : null,
    userName: me ? `${me.firstName} ${me.lastName}`.trim() : "Student",
    isManager,
  };
}

export async function loadHub({ request, params }: OfferingArgs, surface: OfferingSurface) {
  const { auth, applicationId, isManager } = await requireEnrollment(
    request,
    params.offeringId!,
    surface.kind,
  );
  const previewAsStudent =
    isManager && new URL(request.url).searchParams.get("as") === "student";
  const hub = await getHubData({
    offeringId: params.offeringId!,
    userId: auth.user.sub,
    applicationId,
    isManager: isManager && !previewAsStudent,
  });
  if (!hub) throw new Response("Not found", { status: 404 });
  if (surface.kind === "member") {
    recordRouteVisit(auth.user.sub, `${surface.base}/${hub.offering.id}/hub`, hub.offering.title, request);
  }
  return { hub, collabToken: await getCollabToken(request), previewAsStudent };
}

export async function hubAction({ request, params }: OfferingArgs, surface: OfferingSurface) {
  const { auth, isManager } = await requireEnrollment(request, params.offeringId!, surface.kind);
  return runDiscussionAction(await request.formData(), {
    offeringId: params.offeringId!,
    userId: auth.user.sub,
    isManager,
  });
}

export async function withdrawOfferingAction({ request, params }: OfferingArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const formData = await request.formData();
  if (formData.get("intent") !== "withdraw")
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  const result = await withdrawApplication({
    userId: auth.user.sub,
    offeringId: params.offeringId!,
  });
  if ("error" in result && typeof result.error === "string")
    return Response.json({ error: result.error }, { status: result.status });
  return { ok: true };
}
