// Token-addressed access to a *published* form, for the public (no-auth)
// fill route at /f/:token and its submit endpoint /api/f/:token. Kept
// framework-free and separate from forms-data.ts (which is staff-only) so the
// unauthenticated surface has a small, auditable footprint.

import { prisma } from "~/lib/db";
import type { Question } from "~/types";

export type PublicForm = {
  formId: string;
  name: string;
  versionId: string;
  description: unknown;
  // `file` questions need an authenticated upload presign, so they're not
  // fillable anonymously — they're returned but flagged unsupported and the
  // UI renders them disabled. Required file questions are reported so we can
  // surface "this form can't be completed publicly" rather than silently drop.
  questions: Question[];
};

function safeParse(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Resolve a public token to its form's latest version. Returns null when the
// token is unknown, the form is unpublished, or it has no versions yet —
// callers must treat all three as an indistinguishable 404 (don't leak which).
export async function loadPublicForm(
  token: string,
): Promise<PublicForm | null> {
  if (!token) return null;
  const form = await prisma.form.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      name: true,
      published: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true, questions: true, intro: true },
      },
    },
  });
  if (!form || !form.published) return null;
  const version = form.versions[0];
  if (!version) return null;

  return {
    formId: form.id,
    name: form.name,
    versionId: version.id,
    description: safeParse(version.intro),
    questions: (version.questions as unknown as Question[]) ?? [],
  };
}

export type PublicSubmitResult =
  | { ok: true }
  | { error: string; status: number };

// Validate + persist an anonymous submission. `answers` is keyed by question
// `key`. Submitter name/email are optional contact capture, not identity.
export async function submitPublicForm(args: {
  token: string;
  versionId: string;
  answers: Record<string, unknown>;
  submitterName?: string | null;
  submitterEmail?: string | null;
}): Promise<PublicSubmitResult> {
  const form = await prisma.form.findUnique({
    where: { publicToken: args.token },
    select: {
      id: true,
      published: true,
      versions: {
        where: { id: args.versionId },
        select: { id: true, questions: true },
      },
    },
  });
  if (!form || !form.published) return { error: "Form not found", status: 404 };
  const version = form.versions[0];
  if (!version) return { error: "Form version not found", status: 404 };

  const questions = (version.questions as unknown as Question[]) ?? [];

  // Enforce required answers. `file` questions can't be completed publicly,
  // so a required file question makes the form publicly unsubmittable — say
  // so explicitly instead of rejecting an otherwise-complete submission.
  for (const q of questions) {
    if (!q.required) continue;
    if (q.type === "file") {
      return {
        error: "This form has a required file upload and can't be submitted here.",
        status: 422,
      };
    }
    const v = args.answers[q.key];
    const empty =
      v == null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
    if (empty) return { error: `"${q.data.label}" is required.`, status: 400 };
  }

  await prisma.formSubmission.create({
    data: {
      formId: form.id,
      formVersionId: version.id,
      userId: null,
      submitterName: args.submitterName?.trim() || null,
      submitterEmail: args.submitterEmail?.trim() || null,
      answers: args.answers as object,
    },
  });
  return { ok: true };
}
