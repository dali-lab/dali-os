import { useMemo, useState } from "react";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/partner.apply";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { loadApplicationForm } from "~/partners/lib/application-form.server";
import { resolveReferralToken } from "~/partners/lib/partner-referral.server";
import { validateAnswers } from "~/forms/lib/public-form";
import { notifyFormSubmission } from "~/forms/lib/submission-notify.server";
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
import type { Question } from "~/types";
import { sendApplicationReceivedEmail } from "~/partners/lib/partner-emails.server";
import { buttonClasses } from "~/components/ui/Button";

export const meta: Route.MetaFunction = () => [
  { title: "Apply · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  await requirePartnerAccount(request);
  const applicationForm = await loadApplicationForm();
  // Member referral attribution. When a member shares the warm-ref link
  // (/partner/apply?ref=<token>), we resolve the token to the referral row
  // and pass the id forward in a hidden input. The partner never sees it.
  // Note: if partner auth bounces them to /partner/login, the ?ref= in the
  // URL doesn't survive the round-trip — this is acceptable for v1; most
  // warm-ref partners either land already-authed or re-open the link after
  // sign-in. If this becomes a real friction, carry the token in a cookie.
  const refToken = new URL(request.url).searchParams.get("ref");
  const referral = refToken ? await resolveReferralToken(refToken) : null;
  return {
    applicationForm: applicationForm
      ? {
          questions: applicationForm.questions,
          description: applicationForm.description,
          versionUpdatedAt: applicationForm.versionUpdatedAt,
        }
      : null,
    referralId: referral?.id ?? null,
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

  const bad = await validateAnswers(
    applicationForm.questions,
    formAnswers,
    auth.user.sub,
  );
  if (bad) return { error: bad.error };

  const title = deriveApplicationTitle(applicationForm.questions, formAnswers);

  // Warm-ref carry: a hidden input on the form echoes the referralId the
  // loader resolved from ?ref=. We re-resolve inside the transaction so a
  // tampered or stale token can't inject a referrer.
  const postedReferralId = form.get("referralId");
  const refToken = new URL(request.url).searchParams.get("ref");
  let resolvedReferral: Awaited<ReturnType<typeof resolveReferralToken>> = null;
  if (typeof postedReferralId === "string" && postedReferralId && refToken) {
    const current = await resolveReferralToken(refToken);
    if (current && current.id === postedReferralId) resolvedReferral = current;
  }

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
    const app = await tx.partnerApplication.create({
      data: {
        applicantContactId: ctx.contact.id,
        partnerOrgId: null,
        stage: "New",
        source: resolvedReferral ? "Referral" : "Form",
        title,
        formSubmissionId: submission.id,
        referralId: resolvedReferral?.id ?? null,
        referredByUserId: resolvedReferral?.referrerUserId ?? null,
      },
      select: { id: true },
    });
    if (resolvedReferral) {
      // Mark the referral resolved and point it back at this app. The @unique
      // on referralId guards against two apps claiming the same referral if
      // the partner somehow submits twice through the same link.
      await tx.partnerReferral.update({
        where: { id: resolvedReferral.id },
        data: { resolvedAt: new Date() },
      });
    }
    // actorUserId null = partner-originated (the applicant, not a Core member).
    await logPartnerActivity(tx, {
      applicationId: app.id,
      actorUserId: null,
      type: "Created",
      metadata: {
        source: resolvedReferral ? "Referral" : "Form",
        ...(resolvedReferral ? { referralId: resolvedReferral.id } : {}),
      },
    });
    return app;
  });

  if (resolvedReferral) {
    await logAuditEvent({
      action: "partner.referral.linked",
      userId: auth.user.sub,
      targetId: resolvedReferral.id,
      metadata: { applicationId: application.id },
      request,
    });
  }

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
  // The Core-side board create path fires the same event (see
  // createPartnerApplication() in partner-application-create.server.ts) —
  // mirrored here so a portal-submitted application notifies Core too.
  await notifyPartners({
    eventType: "partner.inquiry_received",
    title: `New partner opportunity: ${title}`,
    body: ctx.contact.name ? `From ${ctx.contact.name} (${ctx.contact.email})` : ctx.contact.email,
    link: `/core/partners?application=${application.id}`,
  });
  // notifyFormSubmission tells the form's creator. Confirm to the partner too —
  // submitting used to be met with silence until someone triaged them.
  // Best-effort: a failed confirmation must not lose the application.
  try {
    if (ctx.contact.email) {
      await sendApplicationReceivedEmail(
        ctx.contact.email,
        ctx.contact.name,
        application.id,
      );
    }
  } catch (err) {
    console.error("partner application confirmation failed", {
      applicationId: application.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return redirect(`/partner/applications/${application.id}`);
}

export default function PartnerApply({ actionData }: Route.ComponentProps) {
  const { applicationForm, referralId } = useLoaderData<typeof loader>();
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
        <h1 className="font-heading text-4xl font-medium text-foreground mb-2">
          Apply to partner with DALI
        </h1>
        <p className="text-os-grey">
          Applications aren't open right now.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-heading text-4xl font-medium text-foreground mb-2">
        Apply to partner with DALI
      </h1>
      <p className="text-os-grey mb-8">
        Submit this application first. Once the lab accepts it, you can draft a
        statement of work together with the DALI team.
      </p>

      {error && (
        <p className="mb-4 text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <Form method="post" onSubmit={checkRequired} className="flex flex-col gap-6">
        <section className="flex flex-col gap-5">
          {pager.index === 0 && !isEmptyBlocks(applicationForm.description) && (
            <div className="text-sm text-os-grey">
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
          {referralId && (
            <input type="hidden" name="referralId" value={referralId} />
          )}
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
              className={buttonClasses("primary")}
            >
              {submitting ? "Submitting…" : "Submit application"}
            </button>
          }
        />
      </Form>
    </div>
  );
}
