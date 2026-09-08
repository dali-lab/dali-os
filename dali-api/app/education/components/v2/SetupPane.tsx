import { Form, Link } from "react-router";
import { X } from "lucide-react";
import { Button, buttonClasses } from "~/components/ui/Button";
import { Avatar } from "~/components/ui/Avatar";
import { DriveFolderBindings } from "~/components/drive/DriveFolderBindings";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { InfoTip, Select } from "~/components/ui/floating";
import { InstructorPicker } from "~/education/components/InstructorPicker";
import { OfferingFields } from "~/education/components/OfferingFields";
import { DecisionEmailRow } from "~/education/components/DecisionEmailRow";
import { FeedbackResults } from "~/education/components/FeedbackResults";
import { StatusBadge } from "~/education/components/OfferingCard";
import { useConfirmSubmit } from "~/components/ui/dialog";

export type SetupPaneProps = {
  offeringId: string;
  basePath: string;
  offering: {
    id: string;
    title: string;
    type: string;
    status: string;
    capacity: number;
    approvedCount: number;
    closedOutAt: string | Date | null;
    applicationFormId: string | null;
    descriptionDocId: string | null;
    completionThreshold: number | null;
    registrationOpensAt: string | Date | null;
    registrationClosesAt: string | Date | null;
    requiresReview: boolean;
  };
  emailTemplates: { name: string; versionId: string; subject: string; body: string }[];
  decisionEmailBindings: { status: string; emailTemplateVersionId: string }[];
  builtinDecisionCopy: {
    Approved: { subject: string; body: string };
    Waitlisted: { subject: string; body: string };
    Rejected: { subject: string; body: string };
  };
  publishedForms: { id: string; name: string }[];
  feedbackBindings: { slot: string; formId: string }[];
  sessionFeedback: {
    responded: number;
    eligible: number;
    questions: { key: string; type: string; data: { label: string } }[];
    submissions: { id: string; answers: Record<string, unknown>; submitterName: string | null }[];
  } | null;
  exitFeedback: {
    responded: number;
    eligible: number;
    questions: { key: string; type: string; data: { label: string } }[];
    submissions: { id: string; answers: Record<string, unknown>; submitterName: string | null }[];
  } | null;
  isCore: boolean;
  instructorCandidates: { id: string; name: string }[];
  memberInstructorIds: string[];
  externalInstructors: { userId: string; name: string }[];
  collabToken: string | null | undefined;
  userName: string;
  actionError?: string | null;
  closeOutResult?: { issued: number; alreadyIssued: number; ineligible: number } | null;
};

export function SetupPane({
  offeringId,
  basePath,
  offering,
  emailTemplates,
  decisionEmailBindings,
  builtinDecisionCopy,
  publishedForms,
  feedbackBindings,
  sessionFeedback,
  exitFeedback,
  isCore: core,
  instructorCandidates,
  memberInstructorIds,
  externalInstructors,
  collabToken,
  userName,
  actionError,
  closeOutResult,
}: SetupPaneProps) {
  const confirmSubmit = useConfirmSubmit();

  const nextStatuses: {
    to: string;
    label: string;
    variant: "primary" | "secondary" | "destructive";
  }[] =
    offering.status === "Draft"
      ? [{ to: "Published", label: "Publish", variant: "primary" }]
      : offering.status === "Published"
        ? [
            { to: "Draft", label: "Unpublish", variant: "secondary" },
            { to: "Archived", label: "Archive", variant: "destructive" },
          ]
        : [{ to: "Published", label: "Re-publish", variant: "secondary" }];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-3">
        <Link
          to={`${basePath}/hub`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Course hub
        </Link>
      </header>

      <h1 className="font-heading text-2xl font-bold text-foreground">Setup</h1>

      {actionError && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {actionError}
        </p>
      )}
      {closeOutResult && (
        <p className="text-sm text-foreground bg-green-50 border border-green-200 rounded-md px-3 py-2">
          Close-out complete: {closeOutResult.issued} certificate
          {closeOutResult.issued === 1 ? "" : "s"} issued
          {closeOutResult.alreadyIssued > 0 &&
            `, ${closeOutResult.alreadyIssued} already issued`}
          {closeOutResult.ineligible > 0 &&
            `, ${closeOutResult.ineligible} below the attendance threshold`}
          .
        </p>
      )}

      {/* ── Offering settings ─────────────────────────────────── */}
      <Form
        method="post"
        className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4"
      >
        <h2 className="font-heading text-base font-semibold text-foreground">
          Offering settings
        </h2>
        <input type="hidden" name="intent" value="update-offering" />
        <OfferingFields values={offering as Parameters<typeof OfferingFields>[0]["values"]} typeLocked />
        <div className="flex justify-end">
          <Button type="submit" size="sm">
            Save settings
          </Button>
        </div>
      </Form>

      {/* ── Status & lifecycle ───────────────────────────────── */}
      <section className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
        <h2 className="font-heading text-base font-semibold text-foreground">
          Status &amp; lifecycle
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={offering.status as Parameters<typeof StatusBadge>[0]["status"]} />
          <span className="text-sm text-muted-foreground">
            {offering.approvedCount} of {offering.capacity} seats filled
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {nextStatuses.map((s) => (
            <Form key={s.to} method="post">
              <input type="hidden" name="intent" value="set-status" />
              <input type="hidden" name="status" value={s.to} />
              <Button type="submit" variant={s.variant} size="sm">
                {s.label}
              </Button>
            </Form>
          ))}
          <Form
            method="post"
            onSubmit={confirmSubmit({
              title: "Close out this course?",
              description:
                "Certificates are issued to every approved student meeting the attendance threshold, and each gets an email. Re-running only issues missing certificates.",
              confirmLabel: "Close out",
            })}
          >
            <input type="hidden" name="intent" value="close-out-offering" />
            <Button type="submit" variant="secondary" size="sm">
              {offering.closedOutAt ? "Re-run close-out" : "Close out course"}
            </Button>
          </Form>
        </div>
      </section>

      {/* ── Application form ──────────────────────────────────── */}
      {offering.applicationFormId && (
        <section className="bg-card border border-border rounded-lg p-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-heading text-base font-semibold text-foreground">
              Application form
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Applicants answer this form. Fillers always see the latest saved version.
            </p>
          </div>
          <Link
            to={`/forms/edit/${offering.applicationFormId}`}
            className={buttonClasses("secondary", "sm") + " shrink-0"}
          >
            Edit application form
          </Link>
        </section>
      )}

      {/* ── Decision emails ───────────────────────────────────── */}
      <section className="bg-card border border-border rounded-lg p-5 flex flex-col gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">
            Decision emails
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick a template to email applicants when their status changes.
            Unbound statuses fall back to a short built-in message.
            Templates are shared across areas — manage them in{" "}
            <Link to="/admin/email-templates" className="underline">
              Admin → Email Templates
            </Link>
            . <code className="text-[11px]">{"{{domain}}"}</code> carries the
            offering title.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {(["Approved", "Waitlisted", "Rejected"] as const).map((status) => (
            <DecisionEmailRow
              key={status}
              status={status}
              boundVersionId={
                decisionEmailBindings.find((b) => b.status === status)
                  ?.emailTemplateVersionId ?? ""
              }
              emailTemplates={emailTemplates}
              builtinCopy={builtinDecisionCopy[status]}
              offeringTitle={offering.title}
            />
          ))}
        </div>
      </section>

      {/* ── Feedback forms ────────────────────────────────────── */}
      <section className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">
            Feedback
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Bind published forms from the Forms system. Session feedback is
            requested automatically from everyone marked Present; the exit
            survey goes to instructors at close-out.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {(
            [
              {
                slot: "session-feedback",
                label: "Session feedback",
                tip: "Sent automatically to everyone marked Present after each session.",
              },
              {
                slot: "instructor-exit",
                label: "Instructor exit survey",
                tip: "Sent to instructors when the offering is closed out.",
              },
            ] as const
          ).map(({ slot, label, tip }) => (
            <Form key={slot} method="post" className="flex items-center gap-3">
              <input type="hidden" name="intent" value="set-form-binding" />
              <input type="hidden" name="slot" value={slot} />
              <span className="text-sm text-foreground w-44 inline-flex items-center gap-1">
                {label}
                <InfoTip content={tip} />
              </span>
              <Select
                name="formId"
                defaultValue={
                  feedbackBindings.find((b) => b.slot === slot)?.formId ?? ""
                }
                placeholder="None"
                options={[
                  { value: "", label: "None" },
                  ...publishedForms.map((f) => ({ value: f.id, label: f.name })),
                ]}
                buttonClassName="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
              />
              <Button type="submit" variant="secondary" size="sm">
                Save
              </Button>
            </Form>
          ))}
        </div>
        {sessionFeedback && (
          <FeedbackResults
            title={`Session feedback (${sessionFeedback.submissions.length} response${sessionFeedback.submissions.length === 1 ? "" : "s"})`}
            anonymizedNote={!core}
            results={sessionFeedback}
          />
        )}
        {core && exitFeedback && (
          <FeedbackResults
            title={`Instructor exit surveys (${exitFeedback.submissions.length})`}
            anonymizedNote={false}
            results={exitFeedback}
          />
        )}
      </section>

      {/* ── Instructors (Core only) ──────────────────────────── */}
      {core && (
        <>
          <Form
            method="post"
            className="bg-card border border-border rounded-lg p-5 flex flex-col gap-3"
          >
            <input type="hidden" name="intent" value="set-instructors" />
            <div>
              <h2 className="font-heading text-base font-semibold text-foreground">
                Instructors
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Instructors can edit this offering, review applications, and take attendance.
              </p>
            </div>
            <InstructorPicker
              candidates={instructorCandidates}
              initialSelectedIds={memberInstructorIds}
            />
            <div className="flex justify-end">
              <Button type="submit" variant="secondary" size="sm">
                Save instructors
              </Button>
            </div>
          </Form>

          <section className="bg-card border border-border rounded-lg p-5 flex flex-col gap-3">
            <div>
              <h2 className="font-heading text-base font-semibold text-foreground">
                External instructors
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Dartmouth students who aren&apos;t DALI members. They sign in with
                Dartmouth and get the same management access for this offering.
              </p>
            </div>
            {externalInstructors.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {externalInstructors.map((x) => (
                  <li
                    key={x.userId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted px-2.5 py-1.5 text-sm text-foreground"
                  >
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <Avatar name={x.name} size="xs" />
                      <span className="truncate">{x.name}</span>
                      <span className="rounded bg-accent-coral/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-coral">
                        External
                      </span>
                    </span>
                    <Form method="post">
                      <input type="hidden" name="intent" value="remove-external-instructor" />
                      <input type="hidden" name="userId" value={x.userId} />
                      <button
                        type="submit"
                        aria-label={`Remove ${x.name}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </Form>
                  </li>
                ))}
              </ul>
            )}
            <Form method="post" className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <input type="hidden" name="intent" value="invite-external-instructor" />
              <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                <input
                  name="firstName"
                  required
                  placeholder="First name"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
                <input
                  name="lastName"
                  required
                  placeholder="Last name"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
                <input
                  name="netId"
                  required
                  placeholder="NetID"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30 sm:max-w-[8rem]"
                />
              </div>
              <Button type="submit" variant="secondary" size="sm">
                Invite
              </Button>
            </Form>
          </section>
        </>
      )}

      {/* ── Drive & description ──────────────────────────────── */}
      <section className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4">
        <h2 className="font-heading text-base font-semibold text-foreground">
          Drive &amp; description
        </h2>
        <DriveFolderBindings
          processType="EducationOffering"
          processId={offeringId}
        />
        <div>
          <p className="text-xs font-semibold text-foreground mb-1">Description</p>
          <p className="text-xs text-muted-foreground mb-3">
            Shown on the catalog listing. Edits save live.
          </p>
          {collabToken && offering.descriptionDocId ? (
            <PresenceProvider
              pageId={`eduoffering:${offeringId}`}
              token={collabToken}
              userName={userName}
            >
              <DocEditor
                features="notes"
                aiEnabled
                collab={{
                  documentName: offering.descriptionDocId,
                  token: collabToken,
                  userName,
                }}
                placeholder="What this offering covers, who it's for, what attendees build…"
                className="border border-border rounded-md"
              />
            </PresenceProvider>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Sign in again to edit the description.
            </p>
          )}
        </div>
      </section>

      {/* ── Danger zone (Core, Draft only) ───────────────────── */}
      {core && offering.status === "Draft" && (
        <section className="bg-card border border-destructive/30 rounded-lg p-5 flex flex-col gap-3">
          <h2 className="font-heading text-base font-semibold text-destructive">
            Danger zone
          </h2>
          <p className="text-xs text-muted-foreground">
            Permanently delete this draft offering. This can&apos;t be undone.
          </p>
          <Form
            method="post"
            onSubmit={confirmSubmit({
              title: "Delete this draft offering?",
              description: "This can't be undone.",
              confirmLabel: "Delete",
              tone: "destructive",
            })}
          >
            <input type="hidden" name="intent" value="delete-offering" />
            <Button type="submit" variant="destructive" size="sm">
              Delete draft
            </Button>
          </Form>
        </section>
      )}
    </div>
  );
}
