import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import type { Question } from "~/types";
import {
  buildPublicForm,
  formFillAccess,
  questionsAsServed,
  TERM_BINDING_SELECT,
  validateAnswers,
  type PublicForm,
} from "./public-form";
import { formUsages, managingUsage } from "./form-usages.server";
import {
  RESPONSE_LOCK_SELECT,
  responseLockReason,
} from "./response-lock";

type Failure = { error: string; status: number };

const NOT_FOUND: Failure = { error: "Response not found.", status: 404 };

/** Owner delete of one response. A hard delete: the person can fill again. */
export async function deleteFormResponse(args: {
  formId: string;
  submissionId: string;
  actorId: string;
  request?: Request;
}): Promise<{ ok: true } | Failure> {
  const submission = await prisma.formSubmission.findFirst({
    where: { id: args.submissionId, formId: args.formId },
    select: {
      id: true,
      userId: true,
      formVersionId: true,
      form: { select: { name: true } },
      ...RESPONSE_LOCK_SELECT,
    },
  });
  if (!submission) return NOT_FOUND;
  const locked = responseLockReason(submission, submission.form.name);
  if (locked) {
    return { error: `This response can't be deleted. ${locked}`, status: 409 };
  }

  await prisma.formSubmission.delete({ where: { id: submission.id } });
  await logAuditEvent({
    action: "form.response.delete",
    userId: args.actorId,
    targetId: args.formId,
    metadata: {
      submissionId: submission.id,
      respondentId: submission.userId,
      formVersionId: submission.formVersionId,
    },
    request: args.request,
  });
  return { ok: true };
}

export type EditableResponse = {
  form: NonNullable<Awaited<ReturnType<typeof formForEdit>>>;
  submission: { id: string; answers: Record<string, unknown> };
  version: { id: string; questions: unknown; intro: string | null; updatedAt: Date };
};

async function formForEdit(token: string) {
  return prisma.form.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      name: true,
      published: true,
      oneResponsePerMember: true,
      allowResponseEdit: true,
      page: { select: { iconEmoji: true } },
      cycleBindings: { select: TERM_BINDING_SELECT },
    },
  });
}

/** Every gate for editing one's own response, shared by the fill page and the
 *  PATCH endpoint so the page never offers an edit the endpoint would refuse. */
export async function loadEditableResponse(args: {
  token: string;
  userId: string | null;
  request?: Request;
}): Promise<({ ok: true } & EditableResponse) | Failure> {
  const form = await formForEdit(args.token);
  if (!form || !form.published) {
    return { error: "Form not found for this link.", status: 404 };
  }
  if (!args.userId) return { error: "Sign in to edit your response.", status: 401 };
  if ((await formFillAccess(form, args.userId, args.request)) !== "ok") {
    return { error: "You don't have access to this form.", status: 403 };
  }
  if (!form.allowResponseEdit || !form.oneResponsePerMember) {
    return { error: "This form doesn't allow editing a response.", status: 403 };
  }
  if (managingUsage(await formUsages(form.id))) {
    return { error: "This form doesn't allow editing a response.", status: 403 };
  }

  const submission = await prisma.formSubmission.findFirst({
    where: { formId: form.id, userId: args.userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      answers: true,
      formVersion: {
        select: { id: true, questions: true, intro: true, updatedAt: true },
      },
      ...RESPONSE_LOCK_SELECT,
    },
  });
  if (!submission) return NOT_FOUND;
  if (responseLockReason(submission, form.name)) {
    return { error: "This response can't be edited.", status: 409 };
  }

  return {
    ok: true,
    form,
    submission: {
      id: submission.id,
      answers: (submission.answers as Record<string, unknown>) ?? {},
    },
    version: submission.formVersion,
  };
}

/** Stored answers in the string-valued shape the fill UI keeps. Checkbox
 *  arrays go back to their JSON-string form; answers the screen can't show
 *  (files) are left out and survive the merge on save. */
export function answersToFillState(
  questions: Question[],
  answers: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    if (q.type === "file") continue;
    const v = answers[q.key];
    if (typeof v === "string") out[q.key] = v;
    else if (typeof v === "number") out[q.key] = String(v);
    else if (Array.isArray(v)) out[q.key] = JSON.stringify(v);
  }
  return out;
}

/** The form as the respondent originally answered it (their own version, not
 *  the latest), plus their answers in fill state. */
export async function loadResponseForEditing(args: {
  token: string;
  userId: string;
  request?: Request;
}): Promise<{ form: PublicForm; answers: Record<string, string> } | Failure> {
  const loaded = await loadEditableResponse(args);
  if ("error" in loaded) return loaded;
  const form = await buildPublicForm(loaded.form, loaded.version, args.userId);
  return {
    form,
    answers: answersToFillState(form.questions, loaded.submission.answers),
  };
}

/** Replace the respondent's own answers. Posted answers merge over stored ones
 *  (so file answers the screen can't show survive), then validate against the
 *  stored version. None of submitMemberForm's side effects run. */
export async function editOwnResponse(args: {
  token: string;
  userId: string | null;
  answers: Record<string, unknown>;
  request?: Request;
}): Promise<{ ok: true } | Failure> {
  const loaded = await loadEditableResponse(args);
  if ("error" in loaded) return loaded;

  const questions = questionsAsServed(
    (loaded.version.questions as unknown as Question[]) ?? [],
    loaded.form.cycleBindings,
  );
  const editable = new Set(
    questions
      .filter((q) => q.type !== "file" && q.type !== "info" && q.type !== "pageBreak")
      .map((q) => q.key),
  );
  const posted = Object.fromEntries(
    Object.entries(args.answers).filter(([key]) => editable.has(key)),
  );
  const stored = loaded.submission.answers;
  const merged: Record<string, unknown> = { ...stored, ...posted };

  // A required file question is satisfied by the stored upload, which this
  // screen can't replace.
  const toValidate = questions.map((q) =>
    q.type === "file" && q.required && stored[q.key] != null
      ? { ...q, required: false }
      : q,
  );
  const bad = await validateAnswers(toValidate, merged, args.userId, stored);
  if (bad) return bad;

  await prisma.formSubmission.update({
    where: { id: loaded.submission.id },
    data: { answers: merged as object },
  });
  await logAuditEvent({
    action: "form.response.edit",
    userId: args.userId,
    targetId: loaded.form.id,
    metadata: {
      submissionId: loaded.submission.id,
      formVersionId: loaded.version.id,
    },
    request: args.request,
  });
  return { ok: true };
}
