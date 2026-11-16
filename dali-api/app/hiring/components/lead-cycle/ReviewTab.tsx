import { NavSection } from "~/hiring/components/cycle-setup/SectionNav";
import { ReviewerPoolCard } from "~/hiring/components/cycle-setup/ReviewerPoolCard";
import { DomainRosterCard } from "~/hiring/components/cycle-setup/DomainRosterCard";
import { DomainStatusList } from "~/hiring/components/cycle-setup/DomainStatusList";
import { Pill } from "~/components/ui/Pill";
import type { CurrentMember } from "~/hiring/lib/current-members";
import type { CycleInterviewer, CycleReviewer } from "~/hiring/lib/lead-cycle-types";
import type { LeadCycleData } from "~/hiring/lib/lead-cycle.server";

type Person = { firstName?: string | null; lastName?: string | null; daliEmail?: string | null } | null | undefined;

export const personName = (u: Person, fallback: string) =>
  (u?.firstName && u?.lastName ? `${u.firstName} ${u.lastName}` : u?.daliEmail) ?? fallback;

function rosterDomainsOf(cycle: LeadCycleData["cycle"]) {
  return cycle.domains.map((d) => ({
    id: d.domainId,
    name: d.domain?.name ?? d.domain?.displayName ?? d.domainId,
  }));
}

function memberOptionsOf(members: CurrentMember[]) {
  return members.map((m) => ({ id: m.id, name: personName(m, m.daliEmail) }));
}

function AvailabilityDetail({ interviewer, windowSet }: { interviewer: CycleInterviewer; windowSet: boolean }) {
  if (!windowSet) return <span className="text-muted-foreground">Set the interview window</span>;
  const hours = interviewer.availabilityHours ?? 0;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {hours > 0 ? <span className="text-sm text-os-grey">{hours.toFixed(1)}h free</span> : <Pill tone="warning">No free time</Pill>}
      {!interviewer.hasCalendar && <Pill tone="warning">No calendar</Pill>}
    </span>
  );
}

export function InterviewersSection({
  cycle,
  isMemberCycle,
  members,
  interviewers,
  interviewWindowSet,
  viewRoundId,
  onAdd,
  onRemove,
}: {
  cycle: LeadCycleData["cycle"];
  isMemberCycle: boolean;
  members: CurrentMember[];
  interviewers: CycleInterviewer[];
  interviewWindowSet: boolean;
  viewRoundId: string;
  onAdd: (userId: string, domainId: string) => void;
  onRemove: (interviewerId: string) => void;
}) {
  return (
    <NavSection id="interviewers" title="Interviewers">
      <DomainRosterCard
        title="Interviewers"
        description={
          interviewWindowSet
            ? `${interviewers.filter((i) => (i.availabilityHours ?? 0) > 0).length} of ${interviewers.length} have free time on their calendar.`
            : "Free time shows once the interview window is set."
        }
        role="interviewer"
        mentors={!isMemberCycle}
        domains={rosterDomainsOf(cycle)}
        members={memberOptionsOf(members)}
        people={interviewers.map((i) => ({
          id: i.id,
          userId: i.userId,
          domainId: i.domainId ?? i.domain?.id ?? "",
          name: personName(i.user, "Interviewer"),
          detail: <AvailabilityDetail interviewer={i} windowSet={interviewWindowSet} />,
        }))}
        onAdd={onAdd}
        onRemove={(p) => onRemove(p.id)}
        interviewRoundId={viewRoundId}
      />
    </NavSection>
  );
}

export function ReviewTab({
  data,
  members,
  reviewers,
  interviewers,
  interviewWindowSet,
  viewRoundId,
  hasInterviews,
  onAddReviewer,
  onRemoveReviewer,
  onAddInterviewer,
  onRemoveInterviewer,
}: {
  data: LeadCycleData;
  members: CurrentMember[];
  reviewers: CycleReviewer[];
  interviewers: CycleInterviewer[];
  interviewWindowSet: boolean;
  viewRoundId: string;
  hasInterviews: boolean;
  onAddReviewer: (userId: string, domainId: string) => void;
  onRemoveReviewer: (reviewerId: string) => void;
  onAddInterviewer: (userId: string, domainId: string) => void;
  onRemoveInterviewer: (interviewerId: string) => void;
}) {
  const { cycle, memberSetup } = data;
  const isMemberCycle = memberSetup !== null;
  return (
    <>
      {memberSetup ? (
        <NavSection id="reviewers" title="Reviewer pool">
          <ReviewerPoolCard
            reviewers={memberSetup.reviewerPool}
            members={memberSetup.members}
            hasDomains={cycle.domains.length > 0}
            canResetToDefault={cycle.applicants === "LabMembers"}
          />
        </NavSection>
      ) : (
        <NavSection id="reviewers" title="Reviewers">
          <DomainRosterCard
            title="Reviewers"
            description="Who reads each domain's applications."
            role="reviewer"
            mentors
            domains={rosterDomainsOf(cycle)}
            members={memberOptionsOf(members)}
            people={reviewers.map((r) => ({
              id: r.id,
              userId: r.userId ?? r.user.id,
              domainId: r.domainId ?? r.domain.id,
              name: personName(r.user, "Reviewer"),
            }))}
            onAdd={onAddReviewer}
            onRemove={(p) => onRemoveReviewer(p.id)}
          />
        </NavSection>
      )}
      {hasInterviews && (
        <InterviewersSection
          cycle={cycle}
          isMemberCycle={isMemberCycle}
          members={members}
          interviewers={interviewers}
          interviewWindowSet={interviewWindowSet}
          viewRoundId={viewRoundId}
          onAdd={onAddInterviewer}
          onRemove={onRemoveInterviewer}
        />
      )}
      <NavSection id="review-progress" title="Review progress">
        <DomainStatusList
          title="Review progress"
          rows={cycle.domains.map((d) => {
            const r = data.phaseStatusByDomain?.[d.domainId]?.reviews ?? { assigned: 0, submitted: 0 };
            return {
              domainId: d.domainId,
              name: d.domain?.name ?? d.domainId,
              done: r.assigned > 0 && r.submitted === r.assigned,
              detail: r.assigned === 0 ? "No reviews assigned" : `${r.submitted} of ${r.assigned} submitted`,
            };
          })}
        />
      </NavSection>
    </>
  );
}
