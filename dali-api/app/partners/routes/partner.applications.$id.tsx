import { Form, Link, useLoaderData, useNavigation } from "react-router";
import { PartnerBackLink } from "~/partners/components/PartnerBackLink";
import type { Route } from "./+types/partner.applications.$id";
import { prisma } from "~/lib/db";
import { parseSessionCookie } from "~/lib/cookies";
import { getPresenceUser } from "~/lib/presence-user";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import {
  formAnswerRows,
  type FormAnswerRow,
} from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import {
  PARTNER_APPLICATION_STATUS_LABELS,
  PARTNER_APPLICATION_STATUS_PILL,
  type PartnerApplicationStatus,
} from "../lib/partner-application";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { application?: { title: string } } | undefined)
    ?.application?.title;
  return [{ title: t ? `${t} · DALI OS` : "Application · DALI OS" }];
};

// Partners may refine the pitch while it's still being considered; once a
// decision lands the structured fields freeze (the SOW collab doc stays
// live — it's co-owned with the lab).
const PARTNER_EDITABLE_STATUSES = ["Submitted", "UnderReview"];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth, partnerUser } = await requirePartnerAccount(request);

  // Account-first: an application belongs to the applicant, and (once they're
  // in an org) to that org. Other people's applications 404, never 403.
  const application = await prisma.partnerApplication.findFirst({
    where: {
      id: params.id,
      OR: [
        { applicantUserId: auth.user.sub },
        ...(partnerUser ? [{ partnerOrgId: partnerUser.partnerOrgId }] : []),
      ],
    },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      resultingProjectId: true,
      sowSharedAt: true,
      contractFee: true,
      contractSentAt: true,
      contractSignedAt: true,
      contractSignerName: true,
      legalEntityName: true,
      legalEntityAddress: true,
      formSubmission: {
        select: {
          answers: true,
          formVersion: { select: { questions: true } },
        },
      },
    },
  });
  if (!application) throw new Response("Not found", { status: 404 });

  // Answers to the lab's application-form questions, captured at submit time.
  const formAnswers: FormAnswerRow[] = application.formSubmission
    ? await formAnswerRows(
        (application.formSubmission.formVersion.questions as unknown as Question[]) ?? [],
        (application.formSubmission.answers as Record<string, unknown>) ?? {},
      )
    : [];

  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
    auth.user.email;
  const presenceUser = await getPresenceUser(auth.user.sub, fallbackName);

  const { formSubmission: _formSubmission, ...applicationOut } = application;
  return {
    application: applicationOut,
    formAnswers,
    canEditDetails: PARTNER_EDITABLE_STATUSES.includes(application.status),
    collabToken: parseSessionCookie(request),
    userName: presenceUser?.name ?? fallbackName,
    currentUserId: auth.user.sub,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { auth, partnerUser } = await requirePartnerAccount(request);
  const application = await prisma.partnerApplication.findFirst({
    where: {
      id: params.id,
      OR: [
        { applicantUserId: auth.user.sub },
        ...(partnerUser ? [{ partnerOrgId: partnerUser.partnerOrgId }] : []),
      ],
    },
    select: {
      id: true,
      status: true,
      contractSentAt: true,
      contractSignedAt: true,
    },
  });
  if (!application) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "title";

  if (intent === "sign-contract") {
    if (!application.contractSentAt) {
      return { error: "There's no contract to sign yet." };
    }
    if (application.contractSignedAt) {
      return { error: "This contract has already been signed." };
    }
    const signerName = (form.get("signerName") as string | null)?.trim() ?? "";
    const affirm = form.get("affirm") === "on";
    if (!signerName) return { error: "Type your full name to sign." };
    if (!affirm) return { error: "Confirm the affirmation to sign." };
    const legalEntityName =
      (form.get("legalEntityName") as string | null)?.trim() || null;
    if (!legalEntityName) {
      return { error: "Add the legal entity name." };
    }
    await prisma.partnerApplication.update({
      where: { id: application.id },
      data: {
        legalEntityName,
        legalEntityAddress:
          (form.get("legalEntityAddress") as string | null)?.trim() || null,
        contractSignedAt: new Date(),
        contractSignerName: signerName,
      },
    });
    return { ok: true };
  }

  // Default: edit the pitch title (only while still under consideration).
  if (!PARTNER_EDITABLE_STATUSES.includes(application.status)) {
    return { error: "This application is no longer editable." };
  }
  const title = (form.get("title") as string | null)?.trim() ?? "";
  if (!title) return { error: "A title is required." };
  await prisma.partnerApplication.update({
    where: { id: application.id },
    data: { title },
  });
  return { ok: true };
}

function StatusTimeline({ status }: { status: PartnerApplicationStatus }) {
  const terminal =
    status === "Accepted" || status === "Rejected" || status === "OnHold";
  const activeIndex = terminal ? 2 : status === "UnderReview" ? 1 : 0;
  const steps: { label: string; pillStatus: PartnerApplicationStatus }[] = [
    { label: "Submitted", pillStatus: "Submitted" },
    { label: "Under review", pillStatus: "UnderReview" },
    {
      label: terminal ? PARTNER_APPLICATION_STATUS_LABELS[status] : "Decision",
      pillStatus: terminal ? status : "OnHold",
    },
  ];
  return (
    <ol className="flex items-center gap-2 text-xs">
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-2">
          {i > 0 && <span className="w-6 h-px bg-border" />}
          <span
            className={`rounded-full px-2.5 py-1 ${
              i <= activeIndex
                ? PARTNER_APPLICATION_STATUS_PILL[step.pillStatus]
                : "bg-muted/40 text-muted-foreground"
            }`}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function PartnerApplicationDetail({
  actionData,
}: Route.ComponentProps) {
  const { application, formAnswers, canEditDetails, collabToken, userName, currentUserId } =
    useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const error = actionData && "error" in actionData ? actionData.error : null;

  const documentName = `partnersow:${application.id}:body`;
  const inputClass =
    "w-full rounded-xl border border-border bg-card px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PartnerBackLink to="/partner" label="Back to portal" />
        <div className="flex items-start justify-between gap-4 mt-2 flex-wrap">
          <h1 className="font-heading text-3xl font-bold text-dark-blue">
            {application.title}
          </h1>
          <StatusTimeline status={application.status} />
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Submitted {new Date(application.createdAt).toLocaleDateString()}
        </p>
      </div>

      {application.status === "Accepted" && application.resultingProjectId && (
        <Link
          to={`/partner/projects/${application.resultingProjectId}`}
          className="bg-accent-teal/10 border border-accent-teal/30 rounded-2xl px-5 py-4 text-sm text-accent-teal font-medium hover:bg-accent-teal/15 transition"
        >
          🎉 This pitch became a project — see what the team is up to →
        </Link>
      )}

      {application.contractSentAt && !application.contractSignedAt && (
        <div className="bg-accent-coral/10 border border-accent-coral/30 rounded-2xl px-5 py-4 text-sm text-dark-blue">
          ✍️ A contract is ready for your signature — review and sign it below.
        </div>
      )}

      {application.sowSharedAt &&
        !application.contractSentAt &&
        application.status !== "Accepted" && (
          <div className="bg-accent-coral/10 border border-accent-coral/30 rounded-2xl px-5 py-4 text-sm text-dark-blue">
            📝 A statement of work is ready for your feedback — review and edit it
            together with the DALI team below.
          </div>
        )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      <section className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-heading font-semibold text-dark-blue mb-3">Pitch</h2>
        {canEditDetails && (
          <Form method="post" className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Title
              </label>
              <input name="title" defaultValue={application.title} required className={inputClass} />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="self-start rounded-xl bg-dark-blue text-white text-sm font-heading font-semibold px-5 py-2.5 hover:opacity-90 transition disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save changes"}
            </button>
          </Form>
        )}
        {!canEditDetails && (
          <p className="text-sm text-muted-foreground">
            Your pitch is locked while the lab reviews it.
          </p>
        )}
      </section>

      {formAnswers.length > 0 && (
        <section className="bg-card border border-border rounded-2xl p-5">
          <h2 className="font-heading font-semibold text-dark-blue mb-3">
            Application answers
          </h2>
          <dl className="flex flex-col gap-4">
            {formAnswers.map((row) => (
              <div key={row.key}>
                <dt className="text-xs font-medium text-muted-foreground mb-1">
                  {row.label}
                </dt>
                <dd className="text-sm text-foreground whitespace-pre-wrap">
                  {row.value || "—"}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-heading font-semibold text-dark-blue">
          Statement of Work
        </h2>
        {application.sowSharedAt && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Drafted together with the DALI team — edits sync live. Add your
            thoughts right in the document.
          </p>
        )}
        <div className="mt-3" />
        {/* The SOW is a co-owned doc: it opens once the lab explicitly shares
            a draft with the applicant, not the moment a pitch lands. */}
        {!application.sowSharedAt ? (
          <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg px-4 py-3">
            When the DALI team has a draft ready, they'll share a statement of
            work here for you to review and refine together.
          </p>
        ) : collabToken ? (
          <PresenceProvider
            pageId={`partnersow:${application.id}`}
            token={collabToken}
            userName={userName}
          >
            <DocEditor
              features="notes"
              placeholder="Draft the statement of work…"
              className="border border-border rounded-md bg-card py-2"
              collab={{
                documentName,
                token: collabToken,
                userName,
                userId: currentUserId,
              }}
            />
          </PresenceProvider>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            Sign in again to edit the statement of work.
          </p>
        )}
      </section>

      {application.contractSentAt && (
        <section className="bg-card border border-border rounded-2xl p-5">
          <h2 className="font-heading font-semibold text-dark-blue">Contract</h2>
          {application.contractFee && (
            <p className="text-sm text-muted-foreground mt-1">
              Fee: {application.contractFee}
            </p>
          )}
          <div className="mt-3">
            {collabToken ? (
              <PresenceProvider
                pageId={`partnercontract:${application.id}`}
                token={collabToken}
                userName={userName}
              >
                <DocEditor
                  features="notes"
                  editable={false}
                  className="border border-border rounded-md bg-card py-2"
                  collab={{
                    documentName: `partnercontract:${application.id}:body`,
                    token: collabToken,
                    userName,
                    userId: currentUserId,
                  }}
                />
              </PresenceProvider>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Sign in again to view the contract.
              </p>
            )}
          </div>

          {application.contractSignedAt ? (
            <p className="mt-4 text-sm text-accent-teal bg-accent-teal/10 border border-accent-teal/30 rounded-lg px-4 py-3">
              ✓ Signed by {application.contractSignerName} on{" "}
              {new Date(application.contractSignedAt).toLocaleDateString()}.
            </p>
          ) : (
            <Form method="post" className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
              <input type="hidden" name="intent" value="sign-contract" />
              <h3 className="text-sm font-heading font-semibold text-dark-blue">
                Sign
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">Legal entity name</span>
                  <input
                    name="legalEntityName"
                    required
                    defaultValue={application.legalEntityName ?? ""}
                    className="px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">Your full name</span>
                  <input
                    name="signerName"
                    required
                    placeholder="Type your name to sign"
                    className="px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Legal entity address</span>
                <textarea
                  name="legalEntityAddress"
                  rows={2}
                  defaultValue={application.legalEntityAddress ?? ""}
                  className="px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
              </label>
              <label className="flex items-start gap-2 text-sm text-dark-blue">
                <input type="checkbox" name="affirm" required className="mt-1 rounded" />
                I have read the contract above and, by typing my name, agree to
                it on behalf of the legal entity named.
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="self-start rounded-xl bg-dark-blue text-white font-heading font-semibold px-6 py-3 hover:opacity-90 transition disabled:opacity-50"
              >
                {submitting ? "Signing…" : "Sign contract"}
              </button>
            </Form>
          )}
        </section>
      )}
    </div>
  );
}
