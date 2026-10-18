import { useState } from "react";
import { Form, Link, useLoaderData, useNavigation, useRevalidator } from "react-router";
import { CalendarPlus, ShieldCheck, Download, FileSignature } from "lucide-react";
import { PartnerBackLink } from "~/partners/components/PartnerBackLink";
import { RequestMeetingModal } from "~/partners/components/RequestMeetingModal";
import { PartnerMeetingsSection } from "~/partners/components/PartnerMeetingsSection";
import type { Route } from "./+types/partner.applications.$id";
import { prisma } from "~/lib/db";
import { getCollabToken } from "~/lib/collab-token.server";
import { getPresenceUser } from "~/lib/presence-user";
import { termCodeLabel } from "~/lib/display";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import {
  listPartnerMeetingsForContact,
  listPartnerMeetingRequests,
} from "~/partners/lib/partner-meetings.server";
import { partnerContractStatus } from "~/partners/lib/partner-contract.server";
import { setSowState } from "~/partners/lib/partner-finance.server";
import {
  formAnswerRows,
  type FormAnswerRow,
} from "~/forms/lib/answer-rows.server";
import type { Question } from "~/types";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { buttonClasses } from "~/components/ui/Button";
import {
  PARTNER_STAGE_LABELS,
  PARTNER_STAGE_PILL,
  PARTNER_EDITABLE_STAGES,
  PARTNER_TRACK_NODES,
  partnerTrackIndex,
  type PartnerStage,
} from "../lib/partner-application";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { application?: { title: string } } | undefined)
    ?.application?.title;
  return [{ title: t ? `${t} · DALI OS` : "Application · DALI OS" }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const ctx = await requirePartnerAccount(request);
  const { auth } = ctx;

  // Scoped by contact — other contacts' applications 404, never 403.
  const application = await prisma.partnerApplication.findFirst({
    where: { id: params.id, applicantContactId: ctx.contact.id },
    select: {
      id: true,
      title: true,
      stage: true,
      createdAt: true,
      resultingProjectId: true,
      sowState: true,
      contractBindingId: true,
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

  const [meetings, meetingRequests, contractStatus] = await Promise.all([
    listPartnerMeetingsForContact(ctx.contact.email),
    listPartnerMeetingRequests({ applicationId: application.id }),
    partnerContractStatus(application.id),
  ]);

  const { formSubmission: _formSubmission, ...applicationOut } = application;
  return {
    application: applicationOut,
    contractStatus,
    formAnswers,
    canEditDetails: PARTNER_EDITABLE_STAGES.includes(application.stage),
    // Interview stage is the real target (scheduling the meeting the stage is
    // named for); New is allowed too so a partner isn't stuck waiting for
    // Core to move the card before they can ask for time.
    canRequestMeeting: application.stage === "New" || application.stage === "Interview",
    meetings,
    pendingMeetingRequests: meetingRequests.pending,
    declinedMeetingRequests: meetingRequests.declined,
    collabToken: await getCollabToken(request),
    userName: presenceUser?.name ?? fallbackName,
    currentUserId: auth.user.sub,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const ctx = await requirePartnerAccount(request);
  const application = await prisma.partnerApplication.findFirst({
    where: { id: params.id, applicantContactId: ctx.contact.id },
    select: { id: true, stage: true },
  });
  if (!application) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "title";

  if (intent === "sow-accept") {
    const result = await setSowState({ applicationId: application.id, to: "Accepted", actorUserId: null });
    if ("error" in result) return { error: result.error };
    return { ok: true };
  }

  if (!PARTNER_EDITABLE_STAGES.includes(application.stage)) {
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

const DECISION_NODE_INDEX = PARTNER_TRACK_NODES.indexOf("Decision");

function StageTimeline({
  stage,
  resultingProjectId,
}: {
  stage: PartnerStage;
  resultingProjectId: string | null;
}) {
  const activeIndex = partnerTrackIndex({ stage, resultingProjectId });
  const declinedHere = stage === "Rejected" && activeIndex === DECISION_NODE_INDEX;

  return (
    <ol className="flex items-center gap-2 text-xs">
      {PARTNER_TRACK_NODES.map((label, i) => {
        const atDecision = i === DECISION_NODE_INDEX && i === activeIndex;
        const displayLabel = atDecision ? PARTNER_STAGE_LABELS[stage] : label;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span className="w-6 h-px bg-border" />}
            <span
              className={`rounded-full px-2.5 py-1 ${
                declinedHere && atDecision
                  ? PARTNER_STAGE_PILL.Rejected
                  : i <= activeIndex
                    ? PARTNER_STAGE_PILL.Accepted
                    : "bg-muted/40 text-muted-foreground"
              }`}
            >
              {displayLabel}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function PartnerApplicationDetail({
  actionData,
}: Route.ComponentProps) {
  const {
    application,
    contractStatus,
    formAnswers,
    canEditDetails,
    canRequestMeeting,
    meetings,
    pendingMeetingRequests,
    declinedMeetingRequests,
    collabToken,
    userName,
    currentUserId,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const acceptingSow = navigation.formData?.get("intent") === "sow-accept";
  const submitting = navigation.state === "submitting";
  const error = actionData && "error" in actionData ? actionData.error : null;
  const [requestingMeeting, setRequestingMeeting] = useState(false);

  const documentName = `partnersow:${application.id}:body`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PartnerBackLink to="/partner" label="Back to portal" />
        <div className="flex items-start justify-between gap-4 mt-2 flex-wrap">
          <h1 className="font-heading text-4xl font-medium text-foreground">
            {application.title}
          </h1>
          <StageTimeline stage={application.stage} resultingProjectId={application.resultingProjectId} />
        </div>
        <p className="text-sm text-os-grey mt-1">
          Submitted {new Date(application.createdAt).toLocaleDateString()}
        </p>
        {canRequestMeeting && (
          <button
            type="button"
            onClick={() => setRequestingMeeting(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-dark-blue px-4 py-2 text-sm font-heading font-semibold text-white transition hover:opacity-90"
          >
            <CalendarPlus className="h-4 w-4" /> Request a meeting
          </button>
        )}
      </div>

      {application.stage === "Accepted" && application.resultingProjectId && (
        <Link
          to={`/partner/projects/${application.resultingProjectId}`}
          className="bg-os-accent/10 border border-os-accent/30 rounded-os-card px-5 py-4 text-sm text-os-accent font-medium hover:bg-os-accent/15 transition"
        >
          🎉 This pitch became a project. See what the team is up to →
        </Link>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">{error}</p>
      )}

      <section className="rounded-os-card bg-os-card p-6">
        <h2 className="font-heading text-[19px] font-semibold text-foreground mb-3">Pitch</h2>
        {canEditDetails && (
          <Form method="post" className="os-form flex flex-col gap-4">
            <div>
              <label className="os-field-label mb-1.5 block">
                Title
              </label>
              <input name="title" defaultValue={application.title} required className="w-full" />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className={buttonClasses("primary", "md", "self-start")}
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
        <section className="rounded-os-card bg-os-card p-6">
          <h2 className="font-heading text-[19px] font-semibold text-foreground mb-3">
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

      <section className="rounded-os-card bg-os-card p-6">
        <h2 className="font-heading text-[19px] font-semibold text-foreground">
          Statement of Work
        </h2>
        <div className="mt-3" />
        {/* Readable only once Core shares it; a Draft SOW is still being put
            together on their side. Accepted locks in — no more live editing
            from the portal, which matches Core's lock on their side. */}
        {application.sowState === "Draft" ? (
          <p className="text-sm text-muted-foreground bg-muted/30 rounded-lg px-4 py-3">
            The DALI team is still drafting this. You'll be notified when it's ready to review.
          </p>
        ) : collabToken ? (
          <>
            <PresenceProvider
              pageId={`partnersow:${application.id}`}
              token={collabToken}
              userName={userName}
            >
              <DocEditor
                features="notes"
                editable={false}
                placeholder="No content yet."
                className="border border-border rounded-md bg-card py-2"
                collab={{
                  documentName,
                  token: collabToken,
                  userName,
                  userId: currentUserId,
                }}
              />
            </PresenceProvider>
            {application.sowState === "Shared" && (
              <Form method="post" className="mt-3">
                <input type="hidden" name="intent" value="sow-accept" />
                <button
                  type="submit"
                  disabled={acceptingSow}
                  className="rounded-xl bg-dark-blue px-4 py-2 text-sm font-heading font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {acceptingSow ? "Accepting…" : "Accept statement of work"}
                </button>
              </Form>
            )}
            {application.sowState === "Accepted" && (
              <p className="text-xs text-accent-teal mt-3">You accepted this statement of work.</p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            Sign in again to view the statement of work.
          </p>
        )}
      </section>

      <section className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-heading font-semibold text-dark-blue flex items-center gap-2">
          <FileSignature className="h-4 w-4" /> Contract
        </h2>
        <div className="mt-3" />
        {contractStatus.state === "NotSent" && (
          <p className="text-sm text-muted-foreground">No contract has been sent yet.</p>
        )}
        {contractStatus.state === "Sent" && (
          <Link
            to={`/partner/applications/${application.id}/sign-contract`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-dark-blue px-4 py-2 text-sm font-heading font-semibold text-white transition hover:opacity-90"
          >
            <FileSignature className="h-4 w-4" /> Review and sign your contract
          </Link>
        )}
        {contractStatus.state === "Signed" && (
          <div className="flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 text-accent-teal">
              <ShieldCheck className="h-4 w-4" />
              Signed{contractStatus.signedAt ? ` ${new Date(contractStatus.signedAt).toLocaleDateString()}` : ""}
            </span>
            {contractStatus.pdfUrl && (
              <a
                href={contractStatus.pdfUrl}
                className="inline-flex items-center gap-1 text-accent-coral hover:underline"
              >
                <Download className="h-3.5 w-3.5" /> Download PDF
              </a>
            )}
          </div>
        )}
      </section>

      <PartnerMeetingsSection
        meetings={meetings}
        pendingRequests={pendingMeetingRequests}
        declinedRequests={declinedMeetingRequests}
        onRequestAnother={canRequestMeeting ? () => setRequestingMeeting(true) : undefined}
      />

      {requestingMeeting && (
        <RequestMeetingModal
          scope={{ applicationId: application.id }}
          onClose={() => setRequestingMeeting(false)}
          onSent={() => revalidator.revalidate()}
        />
      )}
    </div>
  );
}
