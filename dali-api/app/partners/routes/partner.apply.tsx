import { useMemo, useState } from "react";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.apply";
import type { Question } from "~/types";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { loadApplicationForm } from "~/partners/lib/application-form.server";
import { validateAnswers } from "~/forms/lib/public-form";
import { notifyFormSubmission } from "~/forms/lib/submission-notify.server";
import { FormFieldList } from "~/forms/components/FormField";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";
import { findMissingRequired } from "~/lib/form-answers";

export const meta: Route.MetaFunction = () => [
  { title: "Apply · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const { auth } = await requirePartnerAccount(request);
  // The application IS the lab-configured form (see PartnerApplicationFormBinding).
  // Scope — target terms, per-domain headcount — is set by Core during review,
  // not asked of the partner up front.
  const applicationForm = await loadApplicationForm(auth.user.sub);
  return {
    applicationForm: applicationForm
      ? {
          questions: applicationForm.questions,
          description: applicationForm.description,
        }
      : null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const { auth, partnerUser } = await requirePartnerAccount(request);
  const form = await request.formData();

  const title = (form.get("title") as string | null)?.trim() ?? "";
  if (!title) return { error: "Give your pitch a title." };

  // Bound-form answers ride along as one JSON field. Re-resolve the form
  // server-side (never trust the client's version/questions) and validate
  // against its latest version — same fallback semantics as submitMemberForm.
  const applicationForm = await loadApplicationForm(auth.user.sub);
  let formAnswers: Record<string, unknown> = {};
  if (applicationForm) {
    const rawAnswers = form.get("formAnswers");
    if (typeof rawAnswers === "string" && rawAnswers) {
      try {
        const parsed: unknown = JSON.parse(rawAnswers);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          formAnswers = parsed as Record<string, unknown>;
        }
      } catch {
        // Unparseable answers fall through to validation, which reports any
        // required question as missing.
      }
    }
    const bad = await validateAnswers(
      applicationForm.questions,
      formAnswers,
      auth.user.sub,
      { allowFileUploads: true },
    );
    if (bad) return { error: bad.error };
  }

  const application = await prisma.$transaction(async (tx) => {
    // The submission is created first so the application can link it by
    // scalar FK (Prisma's unchecked create can't nest a relation the
    // application holds the FK for).
    let formSubmissionId: string | undefined;
    if (applicationForm) {
      const submission = await tx.formSubmission.create({
        data: {
          formId: applicationForm.formId,
          formVersionId: applicationForm.versionId,
          userId: auth.user.sub,
          answers: formAnswers as object,
        },
        select: { id: true },
      });
      formSubmissionId = submission.id;
    }
    // Account-first: the application belongs to the person. An existing partner
    // (already in an org) keeps that link; a fresh applicant has no org yet —
    // one is created only if the lab moves the pitch to a project.
    return tx.partnerApplication.create({
      data: {
        applicantUserId: auth.user.sub,
        partnerOrgId: partnerUser?.partnerOrgId ?? null,
        title,
        formSubmissionId,
      },
      select: { id: true },
    });
  });

  await logAuditEvent({
    action: "partner.application.submitted",
    userId: auth.user.sub,
    targetId: application.id,
    metadata: { partnerOrgId: partnerUser?.partnerOrgId ?? null },
    request,
  });
  if (applicationForm) {
    await notifyFormSubmission({
      formId: applicationForm.formId,
      submitterUserId: auth.user.sub,
    });
  }

  return redirect(`/partner/applications/${application.id}`);
}

function stepOf(q: Question): number {
  return q.data.step ?? 1;
}

export default function PartnerApply({ actionData }: Route.ComponentProps) {
  const { applicationForm } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [title, setTitle] = useState("");
  const [formAnswers, setFormAnswers] = useState<Record<string, string>>({});
  const [clientError, setClientError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);

  const questions = useMemo(
    () => applicationForm?.questions ?? [],
    [applicationForm],
  );

  // Group questions into steps (pages). The title field always leads step 1.
  const steps = useMemo(() => {
    const nums = [...new Set(questions.map(stepOf))].sort((a, b) => a - b);
    const list = nums.map((n) => ({
      title:
        questions.find((q) => stepOf(q) === n && q.data.stepTitle)?.data
          .stepTitle ?? null,
      questions: questions.filter((q) => stepOf(q) === n),
    }));
    return list.length > 0 ? list : [{ title: null, questions: [] }];
  }, [questions]);
  const multiStep = steps.length > 1;
  const lastStep = current >= steps.length - 1;

  const error =
    clientError ??
    (actionData && "error" in actionData ? actionData.error : null);

  // Returns the first missing-required message for a set of questions (plus the
  // title on step 1), or null. The action re-validates everything server-side.
  function firstMissing(stepQuestions: Question[], includeTitle: boolean): string | null {
    if (includeTitle && !title.trim()) return "Give your pitch a title.";
    const missing = findMissingRequired(
      stepQuestions,
      (q) => formAnswers[q.key],
      { excludeFileType: true },
    );
    return missing.length > 0 ? `"${missing[0].data.label}" is required.` : null;
  }

  function goNext() {
    const msg = firstMissing(steps[current].questions, current === 0);
    if (msg) {
      setClientError(msg);
      return;
    }
    setClientError(null);
    setCurrent((c) => Math.min(c + 1, steps.length - 1));
  }

  function checkAllOnSubmit(e: React.FormEvent<HTMLFormElement>) {
    const msg = firstMissing(questions, true);
    if (msg) {
      e.preventDefault();
      setClientError(msg);
      // Jump to the step holding the problem so the field is visible.
      const bad = questions.find((q) => formAnswers[q.key] == null || formAnswers[q.key] === "");
      if (!title.trim()) setCurrent(0);
      else if (bad) {
        const idx = steps.findIndex((s) => s.questions.some((q) => q.key === bad.key));
        if (idx >= 0) setCurrent(idx);
      }
    } else {
      setClientError(null);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral";
  const labelClass = "block text-sm font-medium text-dark-blue mb-1";

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-heading text-3xl font-bold text-dark-blue mb-2">
        Apply to partner with DALI
      </h1>
      <p className="text-muted-foreground mb-6">
        Tell us about your project. If it's a fit, we'll set up a time to talk
        and take it from there — no organization or paperwork needed to apply.
      </p>

      {!isEmptyBlocks(applicationForm?.description) && (
        <div className="text-sm text-muted-foreground mb-6">
          <DocEditor
            features="notes"
            density="compact"
            editable={false}
            initialContent={applicationForm!.description}
          />
        </div>
      )}

      {multiStep && (
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span className="font-medium text-dark-blue">
              {steps[current].title ?? `Step ${current + 1}`}
            </span>
            <span>
              Step {current + 1} of {steps.length}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-accent-coral transition-all"
              style={{ width: `${((current + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <Form method="post" onSubmit={checkAllOnSubmit} className="flex flex-col gap-6">
        {steps.map((step, i) => (
          <section
            key={i}
            className={`flex flex-col gap-5 ${multiStep && i !== current ? "hidden" : ""}`}
          >
            {i === 0 && (
              <div>
                <label htmlFor="title" className={labelClass}>
                  Project title<span className="text-accent-coral ml-0.5">*</span>
                </label>
                <input
                  id="title"
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
            )}
            {step.questions.length > 0 && (
              <FormFieldList
                questions={step.questions}
                values={formAnswers}
                onChange={(k, v) => setFormAnswers((a) => ({ ...a, [k]: v }))}
              />
            )}
          </section>
        ))}

        <input
          type="hidden"
          name="formAnswers"
          value={JSON.stringify(formAnswers)}
        />

        <div className="flex items-center gap-3">
          {multiStep && current > 0 && (
            <button
              type="button"
              onClick={() => {
                setClientError(null);
                setCurrent((c) => Math.max(0, c - 1));
              }}
              className="rounded-xl border border-border bg-card text-dark-blue font-heading font-semibold px-5 py-3 hover:border-accent-coral transition"
            >
              Back
            </button>
          )}
          {multiStep && !lastStep ? (
            <button
              type="button"
              onClick={goNext}
              className="rounded-xl bg-dark-blue text-white font-heading font-semibold px-6 py-3 hover:opacity-90 transition"
            >
              Next
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-dark-blue text-white font-heading font-semibold px-6 py-3 hover:opacity-90 transition disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit application"}
            </button>
          )}
        </div>
      </Form>
    </div>
  );
}
