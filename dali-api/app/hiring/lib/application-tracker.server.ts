import { prisma } from "~/lib/db";
import {
  inferDomainApplicationStatus,
  domainApplicationStatusInclude,
} from "./domain-application-status";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import type { DomainAppData } from "~/hiring/components/ApplicationTracker";

// The applicant's tracker for one cycle: their application's overall status
// and, per selected domain, its inferred stage and any scheduled interview.
// Shared by the student tracker (/portal/hiring) and the member portals.
export async function loadApplicationTracker(
  userId: string,
  cycleId: string,
  cycleStatus: ApplicationCycleStatus,
) {
  const [application, config] = await Promise.all([
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
    prisma.interviewConfig.findUnique({ where: { applicationCycleId: cycleId } }),
  ]);

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

  const domainApplications: DomainAppData[] = (application?.domainApplications ?? []).map((da: any) => {
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
      interview: activeInterview
        ? { id: activeInterview.id, startTime: activeInterview.startTime, endTime: activeInterview.endTime, status: activeInterview.status, location: activeInterview.location, zoomJoinUrl: activeInterview.zoomJoinUrl }
        : null,
    };
  });

  return {
    hasApplication: !!application,
    applicationStatus,
    domainApplications,
    slotDurationMinutes: config?.slotDurationMinutes ?? 30,
  };
}
