import { Link, Form, useActionData } from "react-router";
import { TypeBadge, StatusBadge } from "~/education/components/OfferingCard";
import { OfferingApplyForm } from "~/education/components/OfferingApplyForm";
import { FunnelStatusPanel } from "./FunnelStatusPanel";
import { buttonClasses } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { formatDateTime, formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

// Shape of data the offering-detail loaders must populate when redesign=true.
export type OfferingFunnelData = {
  offering: {
    id: string;
    type: "Miniseries" | "Workshop";
    title: string;
    status: "Draft" | "Published" | "Archived";
    capacity: number;
    approvedCount: number;
    requiresReview: boolean;
    registrationOpensAt: string | Date;
    registrationClosesAt: string | Date;
    startsAt: string | Date | null;
    endsAt: string | Date | null;
    instructors: { name: string }[];
    sessions: { id: string; sequence: number; datetime: string | Date; location: string | null }[];
    descriptionHtml: string;
  };
  myStatus: string | null;
  waitlistRank: number | null;
  // canApply mirrors v1 logic: registrationOpen && (!app || Withdrawn || Submitted)
  canApply: boolean;
  isManager?: boolean;
  // Form data — only present when step=apply AND canApply
  applyForm: {
    questions: import("~/types").Question[];
    description: unknown;
    defaultAnswers?: Record<string, string>;
    versionUpdatedAt?: string;
  } | null;
  step: "detail" | "apply" | "status";
  basePath: string;
};

export function OfferingFunnel({ data }: { data: OfferingFunnelData }) {
  const { offering, myStatus, waitlistRank, canApply, isManager, applyForm, step, basePath } = data;
  const tz = useUserTimeZone();
  const confirmSubmit = useConfirmSubmit();
  const actionData = useActionData<{ error?: string }>();
  const seatsLeft = Math.max(0, offering.capacity - offering.approvedCount);
  const registrationClosesAt = new Date(offering.registrationClosesAt);

  // Header card color tint by type
  const headerBg =
    offering.type === "Miniseries" ? "bg-accent-teal/10" : "bg-accent-coral/15";

  const showApplyForm = step === "apply" && canApply && applyForm !== null;

  // Callout box message for registration window
  const closesFormatted = formatDateShort(registrationClosesAt, tz);
  const seatsPart =
    seatsLeft > 0
      ? `${offering.approvedCount} of ${offering.capacity} seats`
      : `Full — waitlist open`;
  const reviewPart = offering.requiresReview
    ? "Applications are reviewed — not first-come"
    : "First-come RSVP";

  return (
    <div className="flex flex-col gap-6">
      {/* Header card */}
      <div className={`rounded-xl ${headerBg} px-6 py-5 flex flex-col gap-2`}>
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={offering.type} />
          {offering.status !== "Published" && <StatusBadge status={offering.status} />}
          <span className="text-xs text-muted-foreground">
            {offering.sessions.length} session{offering.sessions.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {offering.title}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            {/* Manage link for instructors/Core */}
            {isManager && (
              <Link
                to={`/education/manage/${offering.id}`}
                className={buttonClasses("secondary", "sm")}
              >
                Manage
              </Link>
            )}
          </div>
        </div>
        {offering.instructors.length > 0 && (
          <p className="text-sm text-foreground">
            Taught by {offering.instructors.map((i) => i.name).join(", ")}
          </p>
        )}
      </div>

      {/* Butter-yellow callout: registration window info */}
      <div className="rounded-lg border border-accent-yellow/40 bg-accent-yellow/15 px-4 py-3 text-sm text-foreground">
        Applications close {closesFormatted} · {seatsPart} · {reviewPart}
      </div>

      {/* Main content: form state or status panel or detail CTA */}
      {showApplyForm ? (
        <div className="flex flex-col gap-4 max-w-2xl">
          {actionData?.error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {actionData.error === "This form was just updated — reload to continue." ? (
                <>
                  This form was just updated.{" "}
                  <a href="" className="underline">
                    Reload to continue
                  </a>
                  .
                </>
              ) : (
                actionData.error
              )}
            </div>
          )}
          <div className="bg-card border border-border rounded-lg p-5">
            <OfferingApplyForm
              questions={applyForm!.questions}
              description={applyForm!.description}
              defaultAnswers={applyForm!.defaultAnswers}
              versionUpdatedAt={applyForm!.versionUpdatedAt}
              submitLabel={
                myStatus === "Submitted"
                  ? "Update application"
                  : offering.requiresReview
                    ? "Submit application"
                    : "RSVP"
              }
            />
          </div>
        </div>
      ) : myStatus &&
        myStatus !== "Withdrawn" &&
        // Rejected who can reapply: show detail+CTA instead of status panel
        !(myStatus === "Rejected" && canApply) ? (
        <FunnelStatusPanel
          myStatus={myStatus as "Submitted" | "Waitlisted" | "Approved" | "Rejected"}
          waitlistRank={waitlistRank}
          offeringId={offering.id}
          basePath={basePath}
          canReapply={canApply}
        />
      ) : (
        /* Detail state: no application, or Withdrawn, or Rejected-and-can-reapply */
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-5 py-4">
          <p className="text-sm text-muted-foreground">
            {canApply
              ? "Ready to join this offering?"
              : "Registration for this offering is closed."}
          </p>
          {canApply && (
            <div className="flex items-center gap-2 shrink-0">
              <Link
                to="?step=apply"
                className={buttonClasses("primary", "sm")}
              >
                {offering.requiresReview ? "Apply" : "RSVP"}
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Description */}
      {offering.descriptionHtml && (
        <section
          className="bg-card border border-border rounded-lg p-5 prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: offering.descriptionHtml }}
        />
      )}

      {/* Sessions list */}
      <section>
        <h2 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Sessions
        </h2>
        {offering.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No sessions scheduled yet.</p>
        ) : (
          <ul className="bg-card border border-border rounded-lg divide-y divide-border">
            {offering.sessions.map((s) => (
              <li key={s.id} className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Session {s.sequence}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(s.datetime, tz)}
                    {s.location ? ` · ${s.location}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
