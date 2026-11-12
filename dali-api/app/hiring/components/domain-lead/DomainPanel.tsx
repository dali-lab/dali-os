import { useMemo } from "react";
import { cn } from "~/lib/cn";
import { useCurrentMembers } from "~/hiring/lib/current-members";
import { useNavigate, useSearchParams, useRevalidator } from "react-router";
import { ConfidentialityGate } from "~/hiring/components/ConfidentialityGate";
import { useToast } from "~/components/ui/toast";
import { summarizeDecisionPills, synthesizePrePipelinePill, currentDecisionId, findFinalizableDraft } from "~/hiring/lib/decision-pills";
import { HiringFormEmbed } from "~/hiring/components/HiringFormEmbed";
import { STATUS_LABELS, STATUS_TONES } from "~/hiring/lib/labels";
import { Select, Tooltip } from "~/components/ui/floating";
import { delibRounds } from "~/hiring/lib/cycle-timeline";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import { NavSection, SectionNavLayout } from "~/hiring/components/cycle-setup/SectionNav";
import { AlertIcon, Pill, type PillTone, SetupCard, pillTrigger } from "~/hiring/components/cycle-setup/SetupCard";
import { DomainRosterCard, type RosterPerson } from "~/hiring/components/cycle-setup/DomainRosterCard";
import type { EngagementSummary } from "~/hiring/lib/email-engagement.server";
import { domainReviewStatus } from "~/hiring/lib/domain-windows";
import { OS_TABLE_HEAD, OS_TABLE_ROW, personName } from "~/hiring/components/domain-lead/table-shared";
import { DraftSection, RubricPicker } from "~/hiring/components/domain-lead/DraftSection";
import { DelibsSection } from "~/hiring/components/domain-lead/DelibsSection";
import { DecisionPillBadge, PrePipelinePillBadge } from "~/hiring/components/domain-lead/DecisionPills";
import { DomainApplicationsTable } from "~/hiring/components/domain-lead/DomainApplicationsTable";

export function DomainPanel({ entry, allForms, emailEngagement }: { entry: any; allForms: { id: string; name: string }[]; emailEngagement: Record<string, EngagementSummary> }) {
  const { assignment, cycle, availableCycles, apps, linkedChallengeForms, isChallengeReady, interviews, reviewers: cycleReviewers, delibsSessions, draftDecisions, cycleReviewersForDomain, delibRounds: roundSummaries, rubricVersionOptions, currentRubricVersionId, rubricCriteria, interviewers, hasApplicationReviews, confidentialityRequired } = entry;
  const os = useOsChrome();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const toast = useToast();
  const dialog = useDialog();
  const currentMembers = useCurrentMembers();
  const members = useMemo(
    () => currentMembers.map((m) => ({ id: m.id, name: personName(m) ?? m.id })),
    [currentMembers],
  );
  const [, setSearchParams] = useSearchParams();
  const setCycle = (cycleId: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("cycle", cycleId);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  // The picker carries every cycle this domain has run, so a name alone no
  // longer identifies one — two Students cycles a year apart read the same.
  // The status rides along as the option's description. Rendered whenever
  // there is a cycle you are not already on, which includes the case where no
  // cycle is selected at all: a domain whose cycles have all completed has no
  // default, and without the picker there would be no way to reach them.
  const cyclePicker = (availableCycles ?? []).some(
    (c: { id: string }) => c.id !== cycle?.id,
  ) ? (
    <div className="w-56">
      <Select
        ariaLabel="Cycle"
        value={cycle?.id}
        placeholder="Pick a cycle"
        onChange={setCycle}
        options={(availableCycles ?? []).map(
          (c: { id: string; name: string; status?: string | null }) => ({
            value: c.id,
            label: c.name,
            description: c.status ? (STATUS_LABELS[c.status] ?? c.status) : undefined,
          }),
        )}
        buttonClassName={pillTrigger(os.formTrigger)}
      />
    </div>
  ) : null;

  const header = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className={os.pageTitle}>{assignment.domain.name}</h1>
      <div className="flex flex-wrap items-center gap-2">
        {cycle?.statusUpdates[0]?.newStatus && (
          <Pill dot={STATUS_TONES[cycle.statusUpdates[0].newStatus] ?? "neutral"}>
            {STATUS_LABELS[cycle.statusUpdates[0].newStatus]}
          </Pill>
        )}
        {cyclePicker ?? (cycle ? <span className={os.bodyText}>{cycle.name}</span> : null)}
      </div>
    </header>
  );

  if (!cycle) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className={os.bodyText}>
          {cyclePicker
            ? "No active cycle. Pick a past cycle above to review it."
            : "No active cycle for this domain."}
        </p>
      </div>
    );
  }

  const currentStatus = domainReviewStatus(
    cycle.statusUpdates[0]?.newStatus ?? null,
    cycle.domains[0] ?? { closeDate: null },
    cycle,
  );
  const hasLinkedChallenge = (linkedChallengeForms ?? []).length > 0;
  const fullyReviewed = apps.filter((a: any) => {
    const da = a.domainApplications?.[0];
    return da?.reviews?.length > 0 && da.reviews.every((r: any) => r.submittedAt);
  }).length;
  const needsReviewers = apps.filter((a: any) => {
    const da = a.domainApplications?.[0];
    return !da?.reviews || da.reviews.length === 0;
  }).length;
  const withDecisions = apps.filter((a: any) => {
    const da = a.domainApplications?.[0];
    return da?.decisions?.some((d: any) => d.stage === "Final" || d.stage === "Released");
  }).length;
  const scheduledInterviews = interviews.filter((i: any) => i.status === "Scheduled").length;
  const completedInterviews = interviews.filter((i: any) => i.status === "Completed").length;
  const domains = [{ id: assignment.domainId, name: assignment.domain.name }];

  async function addToRoster(kind: "reviewers" | "interviewers", userId: string) {
    const res = await fetch(`/api/hiring/cycles/${cycle.id}/${kind}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kind === "reviewers" ? { userId, domainId: assignment.domainId, isLead: false } : { userId, domainId: assignment.domainId }),
    });
    if (res.ok) revalidator.revalidate();
    else toast.error(`Couldn't add ${kind === "reviewers" ? "reviewer" : "interviewer"}.`);
  }

  async function removeFromRoster(kind: "reviewers" | "interviewers", person: RosterPerson) {
    const reviewer = kind === "reviewers";
    const ok = await dialog.confirm({
      title: `Remove ${person.name} as ${reviewer ? "a reviewer" : "an interviewer"}?`,
      description: reviewer
        ? "They will no longer be assignable to applicants in this domain. Any reviews they've already submitted for this cycle will be deleted."
        : "They will no longer be assignable to interviews for this domain.",
      confirmLabel: reviewer ? "Remove reviewer" : "Remove interviewer",
      tone: "destructive",
    });
    if (!ok) return;
    const res = reviewer
      ? await fetch(`/api/hiring/cycles/${cycle.id}/reviewers/${person.id}`, { method: "DELETE", credentials: "include" })
      : await fetch(`/api/hiring/cycles/${cycle.id}/interviewers`, {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interviewerId: person.id }),
        });
    if (res.ok) revalidator.revalidate();
    else {
      const err = await res.json().catch(() => ({}));
      toast.error(`Couldn't remove: ${err.error ?? res.statusText}`);
    }
  }

  const gate = (
    <ConfidentialityGate cycleId={cycle.id} reason={confidentialityRequired} next="/hiring/domain-lead" />
  );

  return (
    <div className="flex flex-col gap-6">
      {header}
      {currentStatus !== "Draft" && !confidentialityRequired && (
        <p className="-mt-4 text-sm text-os-grey">
          {[`${apps.length} submitted`, fullyReviewed > 0 && `${fullyReviewed} reviewed`, withDecisions > 0 && `${withDecisions} decided`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <SectionNavLayout label="Sections">
        {(currentStatus === "Draft" || (currentStatus === "Open" && !isChallengeReady)) && cycle.hasChallenges && (
          <NavSection id="challenges" title="Challenges">
            <SetupCard
              title="Challenges"
              description="The Drive form applicants answer for this domain."
              action={isChallengeReady ? <Pill tone="success">Ready</Pill> : <Pill tone="warning">Not ready</Pill>}
            >
              <DraftSection
                cycle={cycle}
                domainId={assignment.domainId}
                linkedChallengeForms={linkedChallengeForms ?? []}
                allForms={allForms}
                isChallengeReady={isChallengeReady}
              />
            </SetupCard>
          </NavSection>
        )}
        {((currentStatus === "Open" && isChallengeReady) || currentStatus === "UnderReview") && cycle.hasChallenges && (
          <NavSection id="challenges" title="Challenges">
            <SetupCard
              title="Challenges"
              description={hasApplicationReviews ? "Locked once reviewers are assigned." : "Locked while the cycle is running."}
              action={!hasLinkedChallenge && <AlertIcon label="No challenge form linked" />}
            >
              {hasLinkedChallenge ? (
                <div className="flex flex-col gap-3">
                  {linkedChallengeForms.map((cf: any) => (
                    <HiringFormEmbed key={cf.id} formId={cf.formId} name={cf.name} questions={cf.questions ?? []} />
                  ))}
                </div>
              ) : (
                <p className={os.bodyText}>No challenge form linked for this domain.</p>
              )}
            </SetupCard>
          </NavSection>
        )}

        {/* The domain rubric scores the challenge, so a cycle without
            challenges uses only the hiring lead's general rubric. */}
        <NavSection id="rubric" title="Rubric">
          {!cycle.hasChallenges ? (
            <SetupCard
              title="Rubric"
              description="The hiring lead's general rubric applies to every application."
              action={cycle.generalRubricVersionId ? <Pill tone="success">Set</Pill> : <Pill tone="warning">Not set</Pill>}
            >
              {!cycle.generalRubricVersionId && (
                <p className={os.bodyText}>Reviewers can be assigned once the hiring lead sets it.</p>
              )}
            </SetupCard>
          ) : (
            <SetupCard
              title="Rubric"
              description="What reviewers score this domain's challenge on."
              action={currentRubricVersionId ? <Pill tone="success">Set</Pill> : <Pill tone="warning">Not set</Pill>}
            >
              <RubricPicker
                cycleId={cycle.id}
                domainId={assignment.domainId}
                options={rubricVersionOptions ?? []}
                selectedId={currentRubricVersionId}
                locked={hasApplicationReviews}
              />
              {!cycle.generalRubricVersionId && (
                <p className="flex items-center gap-2 text-sm text-os-grey">
                  <AlertIcon label="General rubric not set" />
                  Reviewers can be assigned once the hiring lead sets the general rubric.
                </p>
              )}
            </SetupCard>
          )}
        </NavSection>

        <NavSection id="reviewers" title="Reviewers">
          <DomainRosterCard
            title="Reviewers"
            description="Who reads this domain's applications."
            role="reviewer"
            mentors
            cycleId={cycle.id}
            domains={domains}
            members={members}
            people={cycleReviewers.map((r: any) => ({
              id: r.id,
              userId: r.userId,
              domainId: assignment.domainId,
              name: personName(r.user) ?? r.userId,
            }))}
            onAdd={(userId) => addToRoster("reviewers", userId)}
            onRemove={(p) => removeFromRoster("reviewers", p)}
          />
        </NavSection>

        {cycle.hasInterviews && (
          <NavSection id="interviewers" title="Interviewers">
            <DomainRosterCard
              title="Interviewers"
              description={`${(interviewers ?? []).filter((i: any) => i.availabilityHours > 0).length} of ${(interviewers ?? []).length} have free time on their calendar.`}
              role="interviewer"
              mentors
              cycleId={cycle.id}
              domains={domains}
              members={members}
              people={(interviewers ?? []).map((i: any) => ({
                id: i.id,
                userId: i.userId,
                domainId: assignment.domainId,
                name: personName(i.user) ?? i.userId,
                detail: <FreeTime hours={i.availabilityHours ?? 0} hasCalendar={i.hasCalendar} />,
              }))}
              onAdd={(userId) => addToRoster("interviewers", userId)}
              onRemove={(p) => removeFromRoster("interviewers", p)}
            />
          </NavSection>
        )}

        {/* Reviews: applicants still in review plus review-stage rejects.
            Anyone invited to interview moves to Interviews below. */}
        {currentStatus !== "Draft" && (() => {
          const reviewApps = apps.filter((a: any) => {
            const status = a.domainApplications?.[0]?.inferredStatus;
            return status !== "InvitedToInterview" && status !== "InterviewScheduled" && status !== "PostInterviewPending";
          });
          return (
            <NavSection id="reviews" title="Reviews">
              <SetupCard
                title="Reviews"
                description={
                  confidentialityRequired
                    ? undefined
                    : [`${apps.length} submitted`, `${fullyReviewed} reviewed`, needsReviewers > 0 && `${needsReviewers} need reviewers`]
                        .filter(Boolean)
                        .join(" · ")
                }
              >
                {confidentialityRequired ? gate : reviewApps.length > 0 ? (
                  <DomainApplicationsTable
                    apps={reviewApps}
                    draftDecisions={draftDecisions ?? []}
                    cycleReviewersForDomain={cycleReviewersForDomain}
                    cycleId={cycle.id}
                    domainId={assignment.domainId}
                    currentStatus={currentStatus}
                    canAssignReviewers={!!cycle.generalRubricVersionId && (!cycle.hasChallenges || !!currentRubricVersionId)}
                    rubricCriteria={rubricCriteria ?? []}
                    emailEngagement={emailEngagement}
                  />
                ) : (
                  <p className={cn(os.bodyText, "py-3 text-center")}>No applicants in review.</p>
                )}
              </SetupCard>
            </NavSection>
          );
        })()}

        {currentStatus === "UnderReview" && (
          <NavSection id="delibs" title="Deliberations">
            <SetupCard title="Deliberations" description="Decide as a group, one round at a time.">
              {confidentialityRequired ? gate : (
                <DelibsSection cycleId={cycle.id} domainId={assignment.domainId} sessions={delibsSessions ?? []} rounds={roundSummaries ?? []} />
              )}
            </SetupCard>
          </NavSection>
        )}

        {!cycle.hasInterviews ? null : confidentialityRequired && currentStatus === "UnderReview" ? (
          <NavSection id="interviews" title="Interviews">
            <SetupCard title="Interviews">{gate}</SetupCard>
          </NavSection>
        ) : confidentialityRequired ? null : (() => {
          const invited = apps.filter((a: any) => {
            const status = a.domainApplications?.[0]?.inferredStatus;
            return status === "InvitedToInterview" || status === "InterviewScheduled" || status === "PostInterviewPending";
          });
          const awaitingBooking = invited.filter((a: any) => a.domainApplications?.[0]?.inferredStatus === "InvitedToInterview");
          if (invited.length === 0 && interviews.length === 0) return null;
          const noAvailability =
            invited.length > 0 && (interviewers ?? []).every((i: any) => !(i.availabilityHours > 0));

          // Post-interview applicants whose final-round Draft isn't Final yet.
          // They stay PostInterviewPending (keyed off the latest Released
          // decision), so finalizing happens here rather than under Reviews.
          const finalizableByDaId = new Map<string, any>();
          for (const app of invited) {
            const da = app.domainApplications?.[0];
            if (!da) continue;
            const draft = findFinalizableDraft(da.decisions ?? []);
            if (draft) finalizableByDaId.set(da.id, draft);
          }
          const finalizableCount = finalizableByDaId.size;
          // Not gated on the cycle being UnderReview. Finalizing is an admin
          // step on a decision that already exists, and a cycle reaching
          // Completed with Drafts still outstanding is exactly when it's
          // needed — the gate used to strand them with no reachable action.
          const canFinalize = true;
          const finalizeOne = async (daId: string | undefined) => {
            if (!daId) return;
            const draft = finalizableByDaId.get(daId);
            if (!draft) return;
            await fetch(`/api/hiring/decisions/${draft.id}/finalize`, { method: "POST", credentials: "include" });
            revalidator.revalidate();
          };
          const finalizeAll = async () => {
            for (const draft of finalizableByDaId.values()) {
              await fetch(`/api/hiring/decisions/${draft.id}/finalize`, { method: "POST", credentials: "include" });
            }
            revalidator.revalidate();
          };

          return (
            <NavSection id="interviews" title="Interviews">
              <SetupCard
                title="Interviews"
                description={[
                  awaitingBooking.length > 0 && `${awaitingBooking.length} not booked yet`,
                  scheduledInterviews > 0 && `${scheduledInterviews} scheduled`,
                  completedInterviews > 0 && `${completedInterviews} completed`,
                ].filter(Boolean).join(" · ") || undefined}
                action={
                  canFinalize && finalizableCount > 0 ? (
                    <Tooltip content="Drafts from the final round. Finalizing hands them to the hiring lead to release.">
                      <button type="button" onClick={finalizeAll} className={buttonClasses("primary", "md")}>
                        Finalize all ({finalizableCount})
                      </button>
                    </Tooltip>
                  ) : undefined
                }
              >
                {noAvailability && (
                  <p className="flex items-center gap-2 text-sm text-os-grey">
                    <AlertIcon label="No free time" />
                    No interviewer has free time in the interview window, so applicants can't book yet.
                  </p>
                )}
                {(() => {
                  const fmtAssignment = (a: any) => {
                    const m = a.cycleInterviewer.user;
                    return m.firstName && m.lastName
                      ? `${m.firstName} ${m.lastName}`
                      : m.daliEmail ?? '?';
                  };
                  // Booked rows from interview records.
                  const bookedRows = interviews.map((interview: any) => {
                    const start = new Date(interview.startTime);
                    const end = new Date(interview.endTime);
                    return {
                      key: interview.id,
                      daId: interview.domainApplication?.id as string | undefined,
                      name: `${interview.domainApplication.application.user.firstName} ${interview.domainApplication.application.user.lastName}`,
                      booked: true,
                      status: interview.status as string,
                      time: `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
                      location: interview.room?.name ?? 'Online',
                      zoomJoinUrl: interview.room ? null : interview.zoomJoinUrl,
                      videoUrl: interview.room ? null : interview.videoUrl,
                      inDomain: interview.assignments
                        .filter((a: any) => a.role === 'InDomain' && a.status === 'Active')
                        .map(fmtAssignment)
                        .join(', ') || '—',
                      crossDomain: interview.assignments
                        .filter((a: any) => a.role === 'CrossDomain' && a.status === 'Active')
                        .map((a: any) => `${fmtAssignment(a)} (${a.cycleInterviewer.domain.name})`)
                        .join(', ') || '—',
                    };
                  });
                  // Invited-but-not-booked applicants become rows too.
                  const pendingRows = awaitingBooking.map((app: any) => ({
                    key: `pending-${app.id}`,
                    daId: app.domainApplications?.[0]?.id as string | undefined,
                    name: `${app.user.firstName} ${app.user.lastName}`,
                    booked: false,
                    status: 'Not booked yet',
                    time: '—',
                    location: '—',
                    zoomJoinUrl: null,
                    videoUrl: null,
                    inDomain: '—',
                    crossDomain: '—',
                  }));
                  // Awaiting booking first (needs action), then booked.
                  const rows = [...pendingRows, ...bookedRows];
                  // Decisions/pills for each row, looked up via the
                  // domain application on `invited`. Mirrors the
                  // Reviews table's Decisions column so the two
                  // panels read consistently.
                  const appByDaId = new Map<string, any>();
                  for (const app of invited) {
                    const da = app.domainApplications?.[0];
                    if (da?.id) appByDaId.set(da.id, app);
                  }
                  const renderDecisionCell = (daId: string | undefined) => {
                    if (!daId) return <span className="text-xs text-muted-foreground">—</span>;
                    const app = appByDaId.get(daId);
                    const da = app?.domainApplications?.[0];
                    if (!da) return <span className="text-xs text-muted-foreground">—</span>;
                    const decisions = da.decisions ?? [];
                    const pills = summarizeDecisionPills({ decisions });
                    const currentId = currentDecisionId(decisions);
                    if (pills.length > 0) {
                      return (
                        <div className="flex flex-wrap gap-1">
                          {pills.map((pill, i) => (
                            <DecisionPillBadge key={i} pill={pill} isCurrent={!!pill.id && pill.id === currentId} />
                          ))}
                        </div>
                      );
                    }
                    const prePill = synthesizePrePipelinePill({
                      application: { statusUpdates: app.statusUpdates ?? [] },
                      interviews: da.interviews ?? [],
                      decisions,
                    });
                    return prePill
                      ? <PrePipelinePillBadge pill={prePill} />
                      : <span className="text-xs text-muted-foreground">—</span>;
                  };
                  const statusTone = (row: any): PillTone =>
                    !row.booked ? "warning" : row.status === "Completed" ? "success" : "accent";
                  // Clicking a row opens that applicant's review/detail
                  // page — same target as the Reviews table.
                  const openReview = (row: any) => {
                    if (!row.daId) return;
                    navigate(`/hiring/domain-lead/application/${row.daId}`);
                  };
                  if (rows.length === 0) return null;
                  return (
                    <div>
                      <div className="hidden sm:block -mx-6 overflow-x-auto">
                        <table className="w-full text-sm min-w-[900px]">
                          <thead className={OS_TABLE_HEAD}>
                            <tr>
                              <th className="px-6 py-3 text-left font-medium">Applicant</th>
                              <th className="px-6 py-3 text-left font-medium">Time</th>
                              <th className="px-6 py-3 text-left font-medium">Location</th>
                              <th className="px-6 py-3 text-left font-medium">Status</th>
                              <th className="px-6 py-3 text-left font-medium">Decisions</th>
                              <th className="px-6 py-3 text-left font-medium">In-Domain</th>
                              <th className="px-6 py-3 text-left font-medium">Cross-Domain</th>
                              <th className="px-6 py-3 text-right font-medium">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row) => (
                              <tr
                                key={row.key}
                                onClick={() => openReview(row)}
                                className={cn(OS_TABLE_ROW, row.daId && "cursor-pointer")}
                              >
                                <td className="px-6 py-4 font-medium text-foreground">{row.name}</td>
                                <td className="px-6 py-4 text-muted-foreground">{row.time}</td>
                                <td className="px-6 py-4 text-muted-foreground text-xs">
                                  {row.location}
                                  {(row.videoUrl ?? row.zoomJoinUrl) && (
                                    <a href={row.videoUrl ?? row.zoomJoinUrl ?? ''} target="_blank" rel="noopener noreferrer"
                                       onClick={(e) => e.stopPropagation()}
                                       className="block text-xs text-os-accent hover:text-os-accent-hover mt-0.5">Join Google Meet</a>
                                  )}
                                </td>
                                <td className="px-6 py-4">
                                  <Pill dot={statusTone(row)}>{row.status}</Pill>
                                </td>
                                <td className="px-6 py-4">{renderDecisionCell(row.daId)}</td>
                                <td className="px-6 py-4 text-muted-foreground text-xs">{row.inDomain}</td>
                                <td className="px-6 py-4 text-muted-foreground text-xs">{row.crossDomain}</td>
                                <td className="px-6 py-4 text-right">
                                  {canFinalize && row.daId && finalizableByDaId.has(row.daId) ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); finalizeOne(row.daId); }}
                                      className={buttonClasses("secondary", "xs")}
                                    >
                                      Finalize
                                    </button>
                                  ) : (
                                    <span className="text-xs text-muted-foreground/60">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <ul className="sm:hidden space-y-2">
                        {rows.map((row) => (
                          <li
                            key={row.key}
                            onClick={() => openReview(row)}
                            className={cn("rounded-os-item bg-os-well p-3 space-y-2", row.daId && "cursor-pointer hover:bg-os-container")}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="font-medium text-foreground min-w-0 truncate">{row.name}</div>
                              <Pill dot={statusTone(row)}>{row.status}</Pill>
                            </div>
                            {row.booked && (
                              <>
                                <div className="text-xs text-muted-foreground">{row.time}</div>
                                <div className="text-xs text-muted-foreground">
                                  {row.location}
                                  {(row.videoUrl ?? row.zoomJoinUrl) && (
                                    <a href={row.videoUrl ?? row.zoomJoinUrl ?? ''} target="_blank" rel="noopener noreferrer"
                                       onClick={(e) => e.stopPropagation()}
                                       className="ml-2 text-os-accent hover:text-os-accent-hover">Join Google Meet</a>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground"><span className="font-medium">In-Domain:</span> {row.inDomain}</div>
                                <div className="text-xs text-muted-foreground"><span className="font-medium">Cross-Domain:</span> {row.crossDomain}</div>
                              </>
                            )}
                            <div>
                              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Decisions</div>
                              {renderDecisionCell(row.daId)}
                            </div>
                            {canFinalize && row.daId && finalizableByDaId.has(row.daId) && (
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); finalizeOne(row.daId); }}
                                  className={buttonClasses("secondary", "xs")}
                                >
                                  Finalize
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </SetupCard>
            </NavSection>
          );
        })()}
      </SectionNavLayout>
    </div>
  );
}

export function FreeTime({ hours, hasCalendar }: { hours: number; hasCalendar?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {hours > 0 ? (
        <span className="text-sm text-os-grey">{hours.toFixed(1)}h free</span>
      ) : (
        <Pill tone="warning">No free time</Pill>
      )}
      {hasCalendar === false && <Pill tone="warning">No calendar</Pill>}
    </span>
  );
}
