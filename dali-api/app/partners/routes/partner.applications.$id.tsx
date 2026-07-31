import { Form, Link, useLoaderData, useNavigation } from "react-router";
import { PartnerBackLink } from "~/partners/components/PartnerBackLink";
import type { Route } from "./+types/partner.applications.$id";
import { prisma } from "~/lib/db";
import { parseSessionCookie } from "~/lib/cookies";
import { getPresenceUser } from "~/lib/presence-user";
import { termCodeLabel } from "~/lib/display";
import { requirePartner } from "~/partners/lib/partner-auth.server";
import {
  formAnswerRows,
  type FormAnswerRow,
} from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";
import { CollaborativeEditor } from "~/components/CollaborativeEditor";
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
  const { auth, partnerUser } = await requirePartner(request);

  // Scoped by org — other orgs' applications 404, never 403.
  const application = await prisma.partnerApplication.findFirst({
    where: { id: params.id, partnerOrgId: partnerUser.partnerOrgId },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      resultingProjectId: true,
      targetTerms: {
        orderBy: { term: { sortKey: "asc" } },
        select: { term: { select: { code: true } } },
      },
      domains: {
        select: {
          expectedMembers: true,
          domain: { select: { displayName: true } },
        },
      },
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
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { partnerUser } = await requirePartner(request);
  const application = await prisma.partnerApplication.findFirst({
    where: { id: params.id, partnerOrgId: partnerUser.partnerOrgId },
    select: { id: true, status: true },
  });
  if (!application) throw new Response("Not found", { status: 404 });
  if (!PARTNER_EDITABLE_STATUSES.includes(application.status)) {
    return { error: "This application is no longer editable." };
  }

  const form = await request.formData();
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
  const { application, formAnswers, canEditDetails, collabToken, userName } =
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

        <div className="flex flex-wrap gap-x-8 gap-y-3 mt-5 pt-4 border-t border-border">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              Target terms
            </div>
            <div className="text-sm text-foreground">
              {application.targetTerms.length > 0
                ? application.targetTerms
                    .map((t) => termCodeLabel(t.term.code))
                    .join(", ")
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">
              Expected work
            </div>
            <div className="text-sm text-foreground">
              {application.domains.length > 0
                ? application.domains
                    .map(
                      (d) =>
                        `${d.domain.displayName}${d.expectedMembers ? ` (~${d.expectedMembers})` : ""}`,
                    )
                    .join(", ")
                : "—"}
            </div>
          </div>
        </div>
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
        {application.status !== "Submitted" && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Drafted together with the DALI team — edits sync live.
          </p>
        )}
        <div className="mt-3" />
        {/* The SOW is a co-owned doc: it opens once the lab is actually in
            the room (review has started), not the moment a pitch lands. */}
        {application.status === "Submitted" ? (
          <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg px-4 py-3">
            This document opens when the lab starts reviewing your pitch —
            you'll draft the details here together with the DALI team.
          </p>
        ) : collabToken ? (
          <PresenceProvider
            pageId={`partnersow:${application.id}`}
            token={collabToken}
            userName={userName}
          >
            <CollaborativeEditor
              editorId={documentName}
              documentName={documentName}
              token={collabToken}
              userName={userName}
              enableImages
              placeholder="Draft the statement of work…"
              className="border border-border rounded-md"
            />
          </PresenceProvider>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            Sign in again to edit the statement of work.
          </p>
        )}
      </section>
    </div>
  );
}
