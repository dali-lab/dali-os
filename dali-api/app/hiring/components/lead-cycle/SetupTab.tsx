import { Form } from "react-router";
import { Plus } from "lucide-react";
import { cn } from "~/lib/cn";
import { Select, type SelectOption } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { defaultTimelineFor } from "~/hiring/lib/applicant-groups";
import type { Timeline } from "~/hiring/lib/cycle-timeline";
import { decisionSlot, notificationSlot } from "~/hiring/lib/email-variables";
import type { LeadCycleData } from "~/hiring/lib/lead-cycle.server";
import { TargetDomainsCard } from "~/hiring/components/cycle-setup/TargetDomainsCard";
import { TermDatesCard } from "~/hiring/components/cycle-setup/TermDatesCard";
import { ApplicationEventsCard } from "~/hiring/components/cycle-setup/ApplicationEventsCard";
import { AudienceCard } from "~/hiring/components/cycle-setup/AudienceCard";
import { NavSection } from "~/hiring/components/cycle-setup/SectionNav";
import { type DomainChallenge } from "~/hiring/components/cycle-setup/ChallengeLine";
import { TimelineCard } from "~/hiring/components/cycle-setup/TimelineCard";
import { SetupCard, rowTrigger } from "~/hiring/components/cycle-setup/SetupCard";
import { ConfidentialityAgreementPicker } from "~/hiring/components/ConfidentialityAgreementPicker";
import { CloseDateCard } from "~/hiring/components/lead-cycle/CloseDateCard";
import { BlindReviewToggle, CycleFormRow, GeneralApplicationSection } from "~/hiring/components/lead-cycle/CycleFormSettings";
import { DomainOverridePanel } from "~/hiring/components/lead-cycle/DomainOverridePanel";
import { DECISION_EMAIL_SLOTS, LATER_INTERVIEW_INVITE_EMAIL_SLOT, CONTINUED_INTEREST_EMAIL_SLOT, EmailStatusSection, NOTIFICATION_EMAIL_SLOTS } from "~/hiring/components/lead-cycle/EmailStatusSection";

export function SetupTab({
  data,
  cycleStatus,
  timeline,
  hasInterviews,
  hasLaterInterviewRounds,
}: {
  data: LeadCycleData;
  cycleStatus: string;
  timeline: Timeline;
  hasInterviews: boolean;
  hasLaterInterviewRounds: boolean;
}) {
  const os = useOsChrome();
  const { cycle, memberSetup } = data;
  const isMemberCycle = memberSetup !== null;
  const domainsTitle = cycle.applicants === "LabMembers" ? "Applicant pool" : isMemberCycle ? "Target domains" : "Domains";
  const challengeFor = (domainId: string): DomainChallenge | null => {
    if (!cycle.hasChallenges) return null;
    const forms = cycle.domainChallengeForms
      .filter((f) => f.domainId === domainId)
      .map((f) => ({ id: f.id, formId: f.formId, name: f.form.name, ...f.form.versions[0] }));
    const linked = new Set(forms.map((f) => f.formId));
    return { forms, pickable: data.allForms.filter((f) => !linked.has(f.id)) };
  };

  return (
    <div className="flex flex-col gap-6">
      <NavSection id="term-dates" title="Term and dates">
      <TermDatesCard
        termId={cycle.termId ?? null}
        termOptions={data.termOptions ?? []}
        openDate={cycle.openDate ?? null}
        closeDate={cycle.originalCloseDate ?? cycle.closeDate ?? null}
        cycleStatus={cycleStatus}
        startTermIds={cycle.startTermIds ?? []}
        startTermCandidates={data.startTermCandidates ?? []}
        showStartTerms={cycle.applicants === "Students"}
        offerRespondBy={cycle.offerRespondBy ?? null}
        waitlistRespondBy={cycle.waitlistRespondBy ?? null}
        showRespondBy={cycle.applicants !== "LabMembers"}
      />
      </NavSection>

      <NavSection id="audience" title="Audience">
      <AudienceCard
        applicants={cycle.applicants}
        hasChallenges={cycle.hasChallenges}
        cycleStatus={cycleStatus}
        viewerIsAdmin={!!data.viewerIsAdmin}
      />
      </NavSection>

      {/* Extending the close only makes sense once a close date is set. */}
      {cycle.closeDate && (
        <NavSection id="extension" title="Deadline extension">
        <CloseDateCard
          cycle={cycle}
          cycleStatus={cycleStatus}
        />
        </NavSection>
      )}

      <NavSection id="events" title="Application events">
      <ApplicationEventsCard
        cycleId={cycle.id}
        events={data.hiringEvents ?? []}
        announcementTemplateBound={!!data.hiringEmails?.["notification:ApplicationEventAnnouncement"]}
        recipientCount={data.announcementRecipientCount ?? 0}
        checkIns={data.hiringEventCheckIns ?? {}}
      />
      </NavSection>

      <NavSection id="timeline" title="Timeline">
      <TimelineCard
        timeline={timeline}
        roundsWithBoards={data.roundsWithBoards ?? []}
        cycleStatus={cycleStatus}
        isDefault={JSON.stringify(timeline) === JSON.stringify(defaultTimelineFor(cycle.applicants))}
      />
      </NavSection>

      {/* Domains: Students cycles are set up per domain by domain leads;
          Interns cycles pick target domains here; Lab members cycles hang
          off the single CORE domain linked at creation. */}
      <NavSection id="domains" title={domainsTitle}>
      {cycle.applicants === 'LabMembers' ? (
        <SetupCard
          title="Applicant pool"
          description="Open to all current lab members. Every application goes to Core."
        />
      ) : isMemberCycle ? (
        <TargetDomainsCard
          cycleDomains={cycle.domains ?? []}
          eligibleDomains={memberSetup.eligibleDomains}
          challengeFor={challengeFor}
          cycleStatus={cycleStatus}
        />
      ) : (
        <SetupCard
          title="Domains"
        >
          {(cycle.domains ?? []).length > 0 ? (
            <div className="flex flex-col gap-2">
              {(cycle.domains ?? []).map((d) => (
                <DomainOverridePanel
                  key={d.domainId}
                  domain={d}
                  cycleStatus={cycleStatus}
                  cycleCloseDate={cycle.closeDate ?? null}
                  showRubric={!!cycle.hasChallenges}
                  challenge={challengeFor(d.domainId)}
                  rubricOptions={data.domainRubricVersions ?? []}
                  rubricLocked={(data.reviewedDomainIds ?? []).includes(d.domainId)}
                  domainAddedRecipientCount={data.domainAddedRecipientCount ?? 0}
                />
              ))}
            </div>
          ) : (
            <p className={cn(os.bodyText, 'py-4 text-center')}>No domains added yet.</p>
          )}
          {(cycleStatus === 'Draft' || cycleStatus === 'Open') && (
            <Form method="post" preventScrollReset className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="intent" value="add-domain" />
              <div className={cn(os.fieldLabel, 'min-w-[14rem] flex-1')}>
                Add domain
                <Select
                  name="domainId"
                  defaultValue=""
                  placeholder="Pick a domain"
                  options={(data.allDomains ?? [])
                    .filter((d) => !(cycle.domains ?? []).some((cd) => cd.domainId === d.id))
                    .map((d): SelectOption => ({ value: d.id, label: d.name }))}
                  buttonClassName={rowTrigger(os.formTrigger)}
                />
              </div>
              <button type="submit" className={buttonClasses('primary', 'md', 'h-9')}>
                <Plus className="w-4 h-4" aria-hidden /> Add
              </button>
            </Form>
          )}
        </SetupCard>
      )}
      </NavSection>

      <NavSection id="general-application" title="General application">
        <GeneralApplicationSection
          cycleStatus={cycleStatus}
          applicationForm={cycle.applicationForm ?? null}
          allForms={data.allForms ?? []}
          currentRubricVersionId={cycle.generalRubricVersionId}
          rubricVersionOptions={data.rubricVersionOptions ?? []}
          rubricLocked={(data.cycleApplicationReviewCount ?? 0) > 0}
        />
      </NavSection>

      {/* Reusing a waitlisted application is a student-cycle flow. */}
      {cycle.applicants === 'Students' && (
        <NavSection id="continued-interest" title="Continued interest">
          <SetupCard
            title="Continued interest"
            description="Returning waitlisters can reuse their waitlisted application and fill out this form with it. Without a form, reuse isn't offered."
          >
            <div className="flex flex-col gap-3 rounded-os-item bg-os-well p-4">
              <CycleFormRow
                form={cycle.continuedInterestForm ?? null}
                allForms={data.allForms ?? []}
                // Each reused application pins the form version it
                // answered, so a swap only affects reuses started after it.
                swappable
                createIntent="create-continued-interest-form"
                setIntent="set-continued-interest-form"
                ariaLabel="Continued interest form"
              />
            </div>
          </SetupCard>
        </NavSection>
      )}





      {/* Blind review */}
      <NavSection id="blind-review" title="Blind review">
      <BlindReviewToggle anonymizeReview={cycle.anonymizeReview ?? true} />
      </NavSection>

      {/* Confidentiality Agreement */}
      <NavSection id="confidentiality" title="Confidentiality agreement">
      <ConfidentialityAgreementPicker
        currentBinding={data.currentConfidentialityBinding ?? null}
        agreementOptions={data.confidentialityAgreementOptions ?? []}
        signatures={data.confidentialitySignatures ?? []}
      />
      </NavSection>

      {/* Decision-release email bindings */}
      <NavSection id="decision-emails" title="Decision emails">
      <EmailStatusSection
        title="Decision emails"
        description="The email each released decision sends."
        hiringEmails={data.hiringEmails ?? {}}
        canEdit={!!data.viewerIsCore}
        slots={[
          ...DECISION_EMAIL_SLOTS.filter(
            (slot) => hasInterviews || slot.type !== "InvitedToInterview",
          ).map((slot) => ({ ...slot, templateSlot: decisionSlot(slot.type) })),
          ...(hasLaterInterviewRounds ? [LATER_INTERVIEW_INVITE_EMAIL_SLOT] : []),
          ...(cycle.applicants === 'Students' ? [CONTINUED_INTEREST_EMAIL_SLOT] : []),
        ]}
      />
      </NavSection>

      {/* Non-decision notification email bindings. Application slots fire
          from the student portal; interview slots only with interviews. */}
      {(!isMemberCycle || hasInterviews) && (
        <NavSection id="notification-emails" title="Notification emails">
        <EmailStatusSection
          title="Notification emails"
          description="The email each notification sends."
          hiringEmails={data.hiringEmails ?? {}}
          canEdit={!!data.viewerIsCore}
          slots={NOTIFICATION_EMAIL_SLOTS.filter((slot) =>
            slot.type.startsWith('Interview') ? hasInterviews : !isMemberCycle,
          ).map((slot) => ({ ...slot, templateSlot: notificationSlot(slot.type) }))}
        />
        </NavSection>
      )}
    </div>
  );
}
