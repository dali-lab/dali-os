import { prisma } from "~/lib/db";
import {
  inferDomainApplicationStatus,
  domainApplicationStatusInclude,
} from "./domain-application-status";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import type { DomainAppData } from "~/hiring/components/ApplicationTracker";
import { ensureInterviewMeetUrl } from "~/hiring/lib/interview-meet";
import { applicantDeadline, domainCloseDate, isDomainClosed } from "./domain-windows";
import { joinNames } from "./tracker-stage";
import { FIRST_INTERVIEW_ROUND_ID } from "./cycle-timeline";
import { APPLICATION_TZ, formatInTimeZone } from "~/lib/timezone";

// The applicant's tracker for one cycle: their application's overall status
// and, per selected domain, its inferred stage and any scheduled interview.
// Shared by the student tracker (/portal/hiring) and the member portals.
export async function loadApplicationTracker(
  userId: string,
  cycleId: string,
  cycleStatus: ApplicationCycleStatus,
) {
  const [application, configs, cycle, readyDomainRows] = await Promise.all([
    prisma.application.findFirst({
      where: { userId, applicationCycleId: cycleId },
      include: {
        statusUpdates: true,
        domainApplications: {
          where: { selected: true },
          include: {
            ...domainApplicationStatusInclude,
            domain: true,
          },
        },
      },
    }),
    prisma.interviewConfig.findMany({
      where: { applicationCycleId: cycleId },
      select: { interviewRoundId: true, slotDurationMinutes: true },
    }),
    prisma.applicationCycle.findUnique({ where: { id: cycleId }, select: { closeDate: true } }),
    prisma.domainApplicationCycle.findMany({
      where: { applicationCycleId: cycleId, isReady: true },
      select: { domainId: true, closeDate: true, domain: { select: { name: true } } },
    }),
  ]);
  const cycleWindow = cycle ?? { closeDate: null };

  // Use the most recent status update so Withdrawn (which always follows Submitted)
  // takes precedence over the earlier Submitted/Draft entries.
  const latestStatus = application?.statusUpdates
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.newStatus;
  const applicationStatus = latestStatus === "Withdrawn"
    ? "Withdrawn"
    : application?.statusUpdates.some((u) => u.newStatus === "Submitted")
      ? "Submitted"
      : application
        ? "Draft"
        : null;

  // Per-ready-domain window: null when a domain isn't in the ready set at all
  // (e.g. a DA whose domain went unready after submission — treated as never
  // closing rather than hiding its card).
  const windowByDomainId = new Map(readyDomainRows.map((d) => [d.domainId, d]));
  const closeDateOf = (domainId: string): Date | null => {
    const w = windowByDomainId.get(domainId);
    return w ? domainCloseDate(w, cycleWindow) : null;
  };
  const isClosed = (domainId: string): boolean => {
    const w = windowByDomainId.get(domainId);
    return w ? isDomainClosed(w, cycleWindow) : false;
  };

  const selectedDomainIds = new Set(
    (application?.domainApplications ?? []).map((da: any) => da.domainId),
  );
  const deadline = applicantDeadline(readyDomainRows, cycleWindow, selectedDomainIds);

  const domainApplications: DomainAppData[] = await Promise.all((application?.domainApplications ?? []).map(async (da: any) => {
    const inferredStatus = inferDomainApplicationStatus(
      { ...da, application: { statusUpdates: application!.statusUpdates } } as any,
      cycleStatus,
    );

    // Find active interview for this DA (filtered to Scheduled/Completed by the include)
    const activeInterview = da.interviews?.find(
      (i: any) => i.status === "Scheduled",
    );

    return {
      id: da.id,
      domainName: da.domain?.name ?? "Unknown",
      domainId: da.domainId,
      inferredStatus,
      closed: isClosed(da.domainId),
      closeDate: closeDateOf(da.domainId)?.toISOString() ?? null,
      submittedAt: da.submittedAt ? da.submittedAt.toISOString() : null,
      interview: activeInterview
        ? {
            id: activeInterview.id,
            startTime: activeInterview.startTime,
            endTime: activeInterview.endTime,
            status: activeInterview.status,
            room: activeInterview.room,
            zoomJoinUrl: activeInterview.zoomJoinUrl,
            videoUrl: await ensureInterviewMeetUrl(activeInterview),
          }
        : null,
    };
  }));

  // Slots are as long as the round the applicant is invited to.
  const invitedRound = (application?.domainApplications ?? [])
    .map((da: any) => da.decisions.find((d: any) => d.stage === "Released"))
    .find((d: any) => d?.type === "InvitedToInterview")?.interviewRoundId;
  const config =
    configs.find((c) => c.interviewRoundId === (invitedRound ?? FIRST_INTERVIEW_ROUND_ID)) ?? configs[0];

  const readyDomains = readyDomainRows.map((d) => ({
    id: d.domainId,
    name: d.domain.name,
    closed: isDomainClosed(d, cycleWindow),
    closeDate: domainCloseDate(d, cycleWindow)?.toISOString() ?? null,
  }));
  // Vacuously true with no ready domains at all — nothing left to apply to.
  const allDomainsClosed = readyDomains.every((d) => d.closed);

  return {
    hasApplication: !!application,
    applicationStatus,
    domainApplications,
    slotDurationMinutes: config?.slotDurationMinutes ?? 30,
    deadline: deadline ? deadline.toISOString() : null,
    allDomainsClosed,
    openDomainsNote: describeOpenDomainsNote(readyDomains),
    hasOpenSelectedDomain: readyDomains.some((d) => !d.closed && selectedDomainIds.has(d.id)),
    addableDomainNames: readyDomains.filter((d) => !d.closed && !selectedDomainIds.has(d.id)).map((d) => d.name),
  };
}

/**
 * When some ready domains have closed and at least one is still open, the
 * line shown under the ApplicationOpen view: which domain(s) closed when, and
 * which are still taking applications. Null when there's nothing to report
 * (no mix of closed and open domains).
 */
export function describeOpenDomainsNote(
  domains: { name: string; closed: boolean; closeDate: string | null }[],
): string | null {
  const closed = domains.filter((d) => d.closed);
  const open = domains.filter((d) => !d.closed);
  if (closed.length === 0 || open.length === 0) return null;

  const byCloseDate = new Map<string, string[]>();
  for (const d of closed) {
    const key = d.closeDate ?? "";
    byCloseDate.set(key, [...(byCloseDate.get(key) ?? []), d.name]);
  }
  const closedSentences = [...byCloseDate.entries()].map(
    ([iso, names]) => `${joinNames(names)} closed ${iso ? formatMonD(iso) : "already"}`,
  );
  const openNames = joinNames(open.map((d) => d.name));
  const verb = open.length === 1 ? "is" : "are";
  return `${closedSentences.join(". ")}. ${openNames} ${verb} still open.`;
}

function formatMonD(iso: string): string {
  return formatInTimeZone(iso, APPLICATION_TZ, { month: "short", day: "numeric" });
}
