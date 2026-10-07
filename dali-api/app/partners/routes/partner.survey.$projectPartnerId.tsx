// Post-project survey fill page (specs/partner-crm.md §11), reached from the
// link sendPartnerSurvey emails. Renders the bound PartnerSurveyFormBinding
// form the same way /partner/apply renders the bound application form.

import { useMemo, useState } from "react";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.survey.$projectPartnerId";
import { prisma } from "~/lib/db";
import { requirePartnerOrgAccess } from "~/partners/lib/partner-auth.server";
import { loadSurveyForm } from "~/partners/lib/partner-survey.server";
import { validateAnswers } from "~/forms/lib/public-form";
import { logPartnerActivity } from "~/partners/lib/partner-activity.server";
import { notifyPartners } from "~/partners/lib/partner-notify.server";
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

export const meta: Route.MetaFunction = () => [{ title: "Project survey · DALI OS" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const link = await prisma.projectPartner.findUnique({
    where: { id: params.projectPartnerId },
    select: {
      id: true,
      surveySubmissionId: true,
      partnerOrgId: true,
      project: { select: { name: true } },
    },
  });
  if (!link) throw new Response("Not found", { status: 404 });
  await requirePartnerOrgAccess(request, link.partnerOrgId);

  if (link.surveySubmissionId) {
    return { projectName: link.project.name, alreadySubmitted: true, surveyForm: null };
  }

  const surveyForm = await loadSurveyForm();
  return {
    projectName: link.project.name,
    alreadySubmitted: false,
    surveyForm: surveyForm
      ? {
          questions: surveyForm.questions,
          description: surveyForm.description,
          versionUpdatedAt: surveyForm.versionUpdatedAt,
        }
      : null,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const link = await prisma.projectPartner.findUnique({
    where: { id: params.projectPartnerId },
    select: { id: true, surveySubmissionId: true, partnerOrgId: true, project: { select: { name: true } } },
  });
  if (!link) throw new Response("Not found", { status: 404 });
  const ctx = await requirePartnerOrgAccess(request, link.partnerOrgId);
  if (link.surveySubmissionId) return { error: "This survey was already submitted." };

  const form = await request.formData();
  const surveyForm = await loadSurveyForm(ctx.auth.user.sub);
  if (!surveyForm) return { error: "There's no survey to fill out right now." };

  const loadedFingerprint = form.get("formVersionUpdatedAt");
  if (
    typeof loadedFingerprint === "string" &&
    loadedFingerprint &&
    loadedFingerprint !== surveyForm.versionUpdatedAt
  ) {
    return { error: "This form was just updated. Reload and re-submit." };
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

  const bad = await validateAnswers(surveyForm.questions, formAnswers, ctx.auth.user.sub);
  if (bad) return { error: bad.error };

  await prisma.$transaction(async (tx) => {
    const submission = await tx.formSubmission.create({
      data: {
        formId: surveyForm.formId,
        formVersionId: surveyForm.versionId,
        userId: ctx.auth.user.sub,
        answers: formAnswers as object,
      },
      select: { id: true },
    });
    await tx.projectPartner.update({
      where: { id: link.id },
      data: { surveySubmissionId: submission.id },
    });
    // actorUserId null = partner-originated, mirroring the apply flow's Created row.
    await logPartnerActivity(tx, {
      orgId: link.partnerOrgId,
      contactId: ctx.contact.id,
      actorUserId: null,
      type: "SurveyReceived",
      body: link.project.name,
      metadata: { projectPartnerId: link.id },
    });
  });

  await notifyPartners({
    eventType: "partner.survey_received",
    title: "Post-project survey received",
    body: link.project.name,
    link: `/core/partners/orgs/${link.partnerOrgId}`,
    dedupKey: `partner.survey.received:${link.id}`,
  });

  return redirect(`/partner/survey/${link.id}`);
}

export default function PartnerSurvey({ actionData }: Route.ComponentProps) {
  const { projectName, alreadySubmitted, surveyForm } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [formAnswers, setFormAnswers] = useState<Record<string, string>>({});
  const [clientError, setClientError] = useState<string | null>(null);

  const pages = useMemo(() => paginateQuestions(surveyForm?.questions ?? []), [surveyForm]);
  const pager = useFormPager(pages);

  const error = clientError ?? (actionData && "error" in actionData ? actionData.error : null);

  function checkRequired(e: React.FormEvent<HTMLFormElement>) {
    const missing = surveyForm
      ? findMissingRequired(surveyForm.questions, (q) => formAnswers[q.key])
      : [];
    if (missing.length > 0) {
      e.preventDefault();
      setClientError(`"${missing[0].data.label}" is required.`);
    } else {
      setClientError(null);
    }
  }

  if (alreadySubmitted) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="font-heading text-3xl font-bold text-dark-blue mb-2">Thanks for the feedback</h1>
        <p className="text-muted-foreground">
          We already have your answers for {projectName}.
        </p>
      </div>
    );
  }

  if (!surveyForm) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="font-heading text-3xl font-bold text-dark-blue mb-2">How did {projectName} go?</h1>
        <p className="text-muted-foreground">There's no survey to fill out right now.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-heading text-3xl font-bold text-dark-blue mb-2">How did {projectName} go?</h1>
      <p className="text-muted-foreground mb-8">
        Your project with the DALI Lab has wrapped up. A few questions to help us improve.
      </p>

      {error && (
        <p className="mb-4 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      <Form method="post" onSubmit={checkRequired} className="flex flex-col gap-6">
        <section className="flex flex-col gap-5">
          {pager.index === 0 && !isEmptyBlocks(surveyForm.description) && (
            <div className="text-sm text-muted-foreground">
              <DocEditor
                features="notes"
                density="compact"
                editable={false}
                initialContent={surveyForm.description}
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
                onChange={(v) => setFormAnswers((a) => ({ ...a, [q.key]: v }))}
              />
            )}
          />
          <input type="hidden" name="formAnswers" value={JSON.stringify(formAnswers)} />
          <input type="hidden" name="formVersionUpdatedAt" value={surveyForm.versionUpdatedAt} />
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
              {submitting ? "Submitting…" : "Submit feedback"}
            </button>
          }
        />
      </Form>
    </div>
  );
}
