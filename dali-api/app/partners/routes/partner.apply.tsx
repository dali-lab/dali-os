import { useMemo, useState } from "react";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.apply";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { loadApplicationForm } from "~/partners/lib/application-form.server";
import { validateAnswers } from "~/forms/lib/public-form";
import { notifyFormSubmission } from "~/forms/lib/submission-notify.server";
import { FormFieldList } from "~/forms/components/FormField";
import {
  useFormPager,
  FormPagerNav,
  FormPageHeading,
} from "~/forms/components/FormPager";
import { paginateQuestions } from "~/lib/form-pages";
import { FormQuestionField } from "~/components/form-builder/QuestionField";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";
import { findMissingRequired } from "~/lib/form-answers";
import type { Question } from "~/types";

export const meta: Route.MetaFunction = () => [
  { title: "Apply · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  await requirePartnerAccount(request);
  const applicationForm = await loadApplicationForm();
  return {
    applicationForm: applicationForm
      ? {
          questions: applicationForm.questions,
          description: applicationForm.description,
          versionUpdatedAt: applicationForm.versionUpdatedAt,
        }
      : null,
  };
}

// Returns the first non-empty answer to a "real" question (skips info,
// pageBreak, file). Arrays are joined with ", ". Falls back to a generic label.
function deriveApplicationTitle(
  questions: Question[],
  answers: Record<string, unknown>,
): string {
  for (const q of questions) {
    if (q.type === "info" || q.type === "pageBreak" || q.type === "file") continue;
    const raw = answers[q.key];
    if (raw === undefined || raw === null) continue;
    const text = Array.isArray(raw)
      ? raw.filter(Boolean).join(", ")
      : String(raw);
    const trimmed = text.trim();
    if (trimmed) return trimmed;
  }
  return "Partner application";
}

export async function action({ request }: Route.ActionArgs) {
  const ctx = await requirePartnerAccount(request);
  const { auth } = ctx;
  const form = await request.formData();

  const applicationForm = await loadApplicationForm(auth.user.sub);
  if (!applicationForm) return { error: "Applications aren't open right now." };

  // Version-fingerprint: if the form was edited between page load and submit,
  // reject so the partner re-reads the new questions.
  const loadedFingerprint = form.get("formVersionUpdatedAt");
  if (
    typeof loadedFingerprint === "string" &&
    loadedFingerprint &&
    loadedFingerprint !== applicationForm.versionUpdatedAt
  ) {
    return { error: "This form was just updated — reload and re-submit." };
  }

  let formAnswers: Record<string, unknown> = {};
  const rawAnswers = form.get("formAnswers");
  if (typeof rawAnswers === "string" && rawAnswers) {
    try {
      const parsed: unknown = JSON.parse(rawAnswers);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        formAnswers = parsed as Record<string, unknown>;
      }
    } catch {
      // Unparseable answers fall through to validation below.
    }
  }

  const bad = await validateAnswers(
    applicationForm.questions,
    formAnswers,
    auth.user.sub,
  );
  if (bad) return { error: bad.error };

  const title = deriveApplicationTitle(applicationForm.questions, formAnswers);

  const application = await prisma.$transaction(async (tx) => {
    const submission = await tx.formSubmission.create({
      data: {
        formId: applicationForm.formId,
        formVersionId: applicationForm.versionId,
        userId: auth.user.sub,
        answers: formAnswers as object,
      },
      select: { id: true },
    });
    return tx.partnerApplication.create({
      data: {
        applicantContactId: ctx.contact.id,
        partnerOrgId: null,
        status: "ApplicationSubmitted",
        source: "Form",
        title,
        formSubmissionId: submission.id,
      },
      select: { id: true },
    });
  });

  await logAuditEvent({
    action: "partner.application.submitted",
    userId: auth.user.sub,
    targetId: application.id,
    metadata: { contactId: ctx.contact.id },
    request,
  });
  await notifyFormSubmission({
    formId: applicationForm.formId,
    submitterUserId: auth.user.sub,
  });

  return redirect(`/partner/applications/${application.id}`);
}

export default function PartnerApply({ actionData }: Route.ComponentProps) {
  const { applicationForm } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [formAnswers, setFormAnswers] = useState<Record<string, string>>({});
  const [clientError, setClientError] = useState<string | null>(null);

  const pages = useMemo(
    () => paginateQuestions(applicationForm?.questions ?? []),
    [applicationForm],
  );
  const pager = useFormPager(pages);

  const error =
    clientError ??
    (actionData && "error" in actionData ? actionData.error : null);

  function checkRequired(e: React.FormEvent<HTMLFormElement>) {
    const missing = applicationForm
      ? findMissingRequired(applicationForm.questions, (q) => formAnswers[q.key])
      : [];
    if (missing.length > 0) {
      e.preventDefault();
      setClientError(`"${missing[0].data.label}" is required.`);
    } else {
      setClientError(null);
    }
  }

  if (!applicationForm) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="font-heading text-3xl font-bold text-dark-blue mb-2">
          Apply to partner with DALI
        </h1>
        <p className="text-muted-foreground">
          Applications aren't open right now.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-heading text-3xl font-bold text-dark-blue mb-2">
        Apply to partner with DALI
      </h1>
      <p className="text-muted-foreground mb-8">
        Submit this application first. Once the lab accepts it, you can draft a
        statement of work together with the DALI team.
      </p>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <Form method="post" onSubmit={checkRequired} className="flex flex-col gap-6">
        <section className="flex flex-col gap-5">
          {pager.index === 0 && !isEmptyBlocks(applicationForm.description) && (
            <div className="text-sm text-muted-foreground">
              <DocEditor
                features="notes"
                density="compact"
                editable={false}
                initialContent={applicationForm.description}
              />
            </div>
          )}
          <FormPageHeading page={pager.page} />
          <FormFieldList
            questions={pager.page.questions}
            values={formAnswers}
            onChange={(k, v) => setFormAnswers((a) => ({ ...a, [k]: v }))}
            renderField={(q) => (
              <FormQuestionField
                question={q}
                value={formAnswers[q.key] ?? ""}
                onChange={(v) =>
                  setFormAnswers((a) => ({ ...a, [q.key]: v }))
                }
              />
            )}
          />
          <input
            type="hidden"
            name="formAnswers"
            value={JSON.stringify(formAnswers)}
          />
          <input
            type="hidden"
            name="formVersionUpdatedAt"
            value={applicationForm.versionUpdatedAt}
          />
        </section>

        <FormPagerNav
          pager={pager}
          getValue={(q) => formAnswers[q.key]}
          onInvalid={(q) => setClientError(`"${q.data.label}" is required.`)}
          onAdvance={() => setClientError(null)}
          submitSlot={
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit application"}
            </button>
          }
        />
      </Form>
    </div>
  );
}
