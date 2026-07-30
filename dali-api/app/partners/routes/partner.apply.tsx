import { useState } from "react";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import { ChevronDown } from "lucide-react";
import { termCodeLabel } from "~/lib/display";
import type { Route } from "./+types/partner.apply";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { currentTerm } from "~/lib/roles";
import { requirePartner } from "~/partners/lib/partner-auth.server";
import { loadApplicationForm } from "~/partners/lib/application-form.server";
import { validateAnswers } from "~/forms/lib/public-form";
import { notifyFormSubmission } from "~/forms/lib/submission-notify.server";
import { FormFieldList } from "~/forms/components/FormField";
import { FormQuestionField } from "~/components/form-builder/QuestionField";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";
import { findMissingRequired } from "~/lib/form-answers";

export const meta: Route.MetaFunction = () => [
  { title: "Apply · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const { auth } = await requirePartner(request);
  const current = await currentTerm();
  const [terms, domains, applicationForm] = await Promise.all([
    prisma.term.findMany({
      // Only current + future terms make sense as staffing targets.
      where: current ? { sortKey: { gte: current.sortKey } } : undefined,
      orderBy: { sortKey: "asc" },
      take: 6,
      select: { id: true, code: true },
    }),
    prisma.domain.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true },
    }),
    // The lab-configured extra questions (see PartnerApplicationFormBinding).
    // Null when none are bound — the structured fields below are the whole form.
    loadApplicationForm(auth.user.sub),
  ]);
  return {
    terms,
    domains,
    applicationForm: applicationForm
      ? {
          questions: applicationForm.questions,
          description: applicationForm.description,
        }
      : null,
  };
}

// Plain text from the form, stored as the single-paragraph ProseMirror doc
// the internal scope editor round-trips (see PartnerApplicationDomain schema
// comment).
function wrapChallenges(text: string) {
  if (!text) return null;
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

export async function action({ request }: Route.ActionArgs) {
  const { auth, partnerUser } = await requirePartner(request);
  const form = await request.formData();

  const title = (form.get("title") as string | null)?.trim() ?? "";
  const termIds = form.getAll("termIds").map(String).filter(Boolean);
  const domainIds = form.getAll("domainIds").map(String).filter(Boolean);

  if (!title) return { error: "Give your pitch a title." };

  // Validate the picked ids exist (form data is client-controlled).
  const [validTerms, validDomains] = await Promise.all([
    prisma.term.findMany({ where: { id: { in: termIds } }, select: { id: true } }),
    prisma.domain.findMany({ where: { id: { in: domainIds }, active: true }, select: { id: true } }),
  ]);

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
    // No structural summary: the qualitative pitch lives in the bound form's
    // answers (see the seeded "Partner application questions" form).
    return tx.partnerApplication.create({
      data: {
        partnerOrgId: partnerUser.partnerOrgId,
        title,
        formSubmissionId,
        targetTerms: {
          create: validTerms.map((t) => ({ termId: t.id })),
        },
        domains: {
          create: validDomains.map((d) => {
            const members = Number(form.get(`expectedMembers:${d.id}`) ?? 0);
            const challenges =
              (form.get(`challenges:${d.id}`) as string | null)?.trim() ?? "";
            return {
              domainId: d.id,
              expectedMembers: Number.isFinite(members) && members > 0 ? Math.floor(members) : 0,
              expectedChallenges: wrapChallenges(challenges) ?? undefined,
            };
          }),
        },
      },
      select: { id: true },
    });
  });

  await logAuditEvent({
    action: "partner.application.submitted",
    userId: auth.user.sub,
    targetId: application.id,
    metadata: { partnerOrgId: partnerUser.partnerOrgId },
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

export default function PartnerApply({ actionData }: Route.ComponentProps) {
  const { terms, domains, applicationForm } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [formAnswers, setFormAnswers] = useState<Record<string, string>>({});
  // Controlled so editing a domain's fields selects the domain — otherwise
  // an expanded-but-unchecked row's input is silently dropped on submit.
  const [checkedDomains, setCheckedDomains] = useState<Set<string>>(new Set());
  const [clientError, setClientError] = useState<string | null>(null);

  function selectDomain(id: string) {
    setCheckedDomains((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }
  const error =
    clientError ??
    (actionData && "error" in actionData ? actionData.error : null);

  // The bound form's fields are controlled components, so required-ness is
  // checked here before the post (the action re-validates server-side).
  function checkRequired(e: React.FormEvent<HTMLFormElement>) {
    if (!applicationForm) return;
    const missing = findMissingRequired(
      applicationForm.questions,
      (q) => formAnswers[q.key],
      { excludeFileType: true },
    );
    if (missing.length > 0) {
      e.preventDefault();
      setClientError(`"${missing[0].data.label}" is required.`);
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
      <p className="text-muted-foreground mb-8">
        Submit this application first. Once the lab accepts it, you can draft a
        statement of work together with the DALI team.
      </p>

      {error && (
        <p className="mb-4 text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <Form method="post" onSubmit={checkRequired} className="flex flex-col gap-6">
        <div>
          <label htmlFor="title" className={labelClass}>
            Project title<span className="text-accent-coral ml-0.5">*</span>
          </label>
          <input id="title" name="title" required className={inputClass} />
        </div>

        {terms.length > 0 && (
          <fieldset>
            <legend className={labelClass}>
              Which terms would you like the team working?
            </legend>
            <div className="flex flex-wrap gap-3 mt-1">
              {terms.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-2 text-sm text-dark-blue bg-card border border-border rounded-lg px-3 py-2"
                >
                  <input type="checkbox" name="termIds" value={t.id} className="rounded" />
                  {termCodeLabel(t.code)}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend className={labelClass}>
            What kinds of work do you expect?
          </legend>
          <div className="flex flex-col gap-3 mt-1">
            {domains.map((d) => (
              <details key={d.id} className="group bg-card border border-border rounded-xl">
                <summary className="flex items-center gap-2 text-sm text-dark-blue px-4 py-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="domainIds"
                    value={d.id}
                    checked={checkedDomains.has(d.id)}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setCheckedDomains((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(d.id);
                        else next.delete(d.id);
                        return next;
                      });
                    }}
                    className="rounded"
                    onClick={(e) => e.stopPropagation()}
                  />
                  {d.displayName}
                  <ChevronDown className="w-4 h-4 text-muted-foreground ml-auto transition-transform group-open:rotate-180" />
                </summary>
                {/* Typing in either field selects the domain, so an expanded-
                    but-unchecked row can't silently lose its input. */}
                <div className="px-4 pb-4 flex flex-col gap-3" onInput={() => selectDomain(d.id)}>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">
                      Expected team members (rough)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      name={`expectedMembers:${d.id}`}
                      defaultValue={0}
                      className="mt-1 w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">
                      What should this discipline tackle?
                    </span>
                    <textarea
                      name={`challenges:${d.id}`}
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              </details>
            ))}
          </div>
        </fieldset>

        {applicationForm && applicationForm.questions.length > 0 && (
          <section className="flex flex-col gap-5 border-t border-border pt-6">
            <h2 className="font-heading text-lg font-semibold text-dark-blue">
              A few more questions
            </h2>
            {Boolean(applicationForm.description) &&
              !isEmptyDoc(applicationForm.description) && (
                <div className="text-sm text-muted-foreground -mt-1">
                  <RichTextViewer content={applicationForm.description} />
                </div>
              )}
            <FormFieldList
              questions={applicationForm.questions}
              values={formAnswers}
              onChange={(k, v) => setFormAnswers((a) => ({ ...a, [k]: v }))}
              renderField={(q) =>
                q.type === "file" ? (
                  <div className="text-xs text-muted-foreground italic border border-dashed border-border rounded-md px-3 py-2">
                    File uploads aren’t available here.
                  </div>
                ) : (
                  <FormQuestionField
                    question={q}
                    value={formAnswers[q.key] ?? ""}
                    onChange={(v) =>
                      setFormAnswers((a) => ({ ...a, [q.key]: v }))
                    }
                  />
                )
              }
            />
            <input
              type="hidden"
              name="formAnswers"
              value={JSON.stringify(formAnswers)}
            />
          </section>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-accent-coral text-white font-heading font-semibold py-3 hover:bg-accent-coral/90 transition disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit application"}
        </button>
      </Form>
    </div>
  );
}
