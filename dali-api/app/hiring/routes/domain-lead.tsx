import { useState, useEffect } from "react";
import { delibsQualifier } from "~/hiring/lib/cycle-stages.server";
import { cn } from "~/lib/cn";
import { Form, Link, useActionData, useLoaderData, useNavigate, useNavigation, useSearchParams, useRevalidator } from "react-router";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { redirect } from "react-router";
import type { Route } from "./+types/domain-lead";
import { prisma } from "~/lib/db";
import { getUserRoles } from "~/lib/roles";
import { requireAuth } from "~/lib/auth";
import { Plus, Trash2, X, ChevronDown, ChevronUp } from "lucide-react";
import { addDomainChallenge, removeDomainChallenge } from "~/hiring/lib/application-form.server";
import { inferDomainApplicationStatus } from "~/hiring/lib/domain-application-status";
import { inReviewPipelineFilter } from "~/hiring/lib/application-pipeline-filter";
import { getReviewStatus } from "~/hiring/lib/review-status";
import { buildCriteriaList } from "~/hiring/lib/rubric-criteria";
import { confidentialityBlock, getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { ConfidentialityGate } from "~/hiring/components/ConfidentialityGate";
import { Modal } from "~/components/Modal";
import { useToast } from "~/components/ui/toast";
import {
  summarizeDecisionPills,
  synthesizePrePipelinePill,
  currentDecisionId,
  type DecisionPill,
  type PrePipelinePill,
  findFinalizableDraft,
} from "~/hiring/lib/decision-pills";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import type { DecisionType, Question } from "~/types";
import { normalizeQuestionBodies } from "~/lib/question-blocks.server";
import { HiringFormEmbed } from "~/hiring/components/HiringFormEmbed";
import { formatVersionLabel } from "~/lib/formatVersion";
import { selectActiveCycleForDomainLead } from "~/hiring/lib/cycle-picker";
import {
  DECISION_LABELS,
  DECISION_TONES,
  RECOMMENDATION_TONES,
  STATUS_LABELS,
  STATUS_TONES,
} from "~/hiring/lib/labels";
import { Select, Tooltip, InfoTip } from "~/components/ui/floating";
import { interviewerCalendars } from "~/hiring/lib/interview-availability.server";
import { delibRounds, parseTimeline } from "~/hiring/lib/cycle-timeline";
import { SearchInput } from "~/components/ui/SearchInput";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { NavSection, SectionNavLayout } from "~/hiring/components/cycle-setup/SectionNav";
import { AlertIcon, Pill, type PillTone, SetupCard, pillTrigger, rowTrigger } from "~/hiring/components/cycle-setup/SetupCard";
import { DomainSubRow, SubRowEmpty } from "~/hiring/components/cycle-setup/DomainSubRow";
import { DomainRosterCard, type RosterPerson } from "~/hiring/components/cycle-setup/DomainRosterCard";
import { addDomainMentors, domainMentorIds } from "~/hiring/lib/cycle-rosters.server";

export const meta: Route.MetaFunction = () => [{ title: "Domain lead · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { domainData: [], pillRoles: null };

  const roles = await getUserRoles(auth.user.sub);
  const pillRoles = {
    isCore: roles.isCore,
    isDomainLead: roles.isDomainLead,
    isAdmin: roles.isAdmin,
    isInterviewer: roles.isInterviewer,
  };

  const assignments = await prisma.domainLeadAssignment.findMany({
    where: { userId: auth.user.sub },
    include: { domain: true },
  });

  if (assignments.length === 0) {
    return { domainData: [], pillRoles };
  }

  const domainData = await Promise.all(
    assignments.map(async (assignment) => {
      const allCycles = await prisma.applicationCycle.findMany({
        where: {
          domains: { some: { domainId: assignment.domainId } },
        },
        include: {
          statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
          domains: { where: { domainId: assignment.domainId } },
          applications: {
            include: {
              user: true,
              statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
              domainApplications: {
                where: {
                  selected: true,
                  domainId: assignment.domainId,
                },
                include: {
                  domain: true,
                  reviews: {
                    include: {
                      cycleReviewer: {
                        include: { user: { select: { firstName: true, lastName: true, daliEmail: true } } },
                      },
                    },
                  },
                  decisions: { orderBy: { createdAt: "desc" } },
                  // Scheduled drives status inference; Completed feeds the
                  // pre-decision "Post-interview" pill in the table.
                  // Cancelled rows stay filtered out (audit-only).
                  interviews: { where: { status: { in: ["Scheduled", "Completed"] } } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Cycles eligible for the picker: every cycle this domain has ever run,
      // in any status. Several can be active at once, and Completed ones are
      // offered so a lead can reopen a past cycle to read its reviews,
      // interviews and decisions back. Which one is shown *by default* is a
      // separate question — see selectActiveCycleForDomainLead, where a
      // Completed cycle is only ever reached through ?cycle=.
      // No extra query cost: allCycles above already loads them all.
      const candidateCycles = allCycles.filter((c) =>
        Boolean(c.statusUpdates[0]?.newStatus),
      );
      const availableCycles = candidateCycles.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.statusUpdates[0]?.newStatus ?? null,
      }));

      const requestedCycleId = new URL(request.url).searchParams.get("cycle");
      const activeCycle = selectActiveCycleForDomainLead(candidateCycles, requestedCycleId);

      if (!activeCycle) return [{ assignment, cycle: null, availableCycles, apps: [], linkedChallengeForms: [], isChallengeReady: false, interviews: [], reviewers: [], delibsSessions: [], draftDecisions: [], cycleReviewersForDomain: [], delibRounds: [] as DomainRoundSummary[], rubricVersionOptions: [], currentRubricVersionId: null, rubricCriteria: [], interviewers: [], hasApplicationReviews: false, confidentialityRequired: null as null | "no_agreement" | "unsigned" }];

      const confState = await getCycleConfidentialityState(auth.user.sub, activeCycle.id);
      const confidentialityRequired = confidentialityBlock(confState);

      return [await (async (cycle) => {

      // Drive challenge Forms linked to this domain in this cycle. The latest
      // version's questions power the inline embed preview (HiringFormEmbed).
      const linkedChallengeFormsRaw = await prisma.cycleDomainForm.findMany({
        where: { applicationCycleId: cycle.id, domainId: assignment.domainId },
        include: {
          form: {
            select: {
              id: true,
              name: true,
              versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { questions: true } },
            },
          },
        },
      });
      const linkedChallengeForms = linkedChallengeFormsRaw.map((cdf) => ({
        id: cdf.id,
        formId: cdf.formId,
        name: cdf.form.name,
        questions: normalizeQuestionBodies(
          (cdf.form.versions[0]?.questions as unknown as Question[]) ?? [],
        ),
      }));

      // isReady lives on DomainApplicationCycle (per domain+cycle, not per challenge version)
      const isChallengeReady = cycle.domains[0]?.isReady ?? false;

      const apps = cycle.applications.filter((app) => {
        const latestStatus = app.statusUpdates[0]?.newStatus;
        return latestStatus === "Submitted" && app.domainApplications.length > 0;
      });

      // Interviews for this domain in this cycle. Both Scheduled and Completed
      // rows appear in the dashboard table — only cancelled rows are excluded
      // (audit-only). Load for any non-Draft cycle: an interview can be booked
      // while the cycle is still Open (a Released invite + scheduled slot), and
      // those applicants must surface in the Interviews section rather than
      // vanishing (they're excluded from Reviews).
      const currentStatus = cycle?.statusUpdates[0]?.newStatus ?? "Draft";
      const interviews = currentStatus !== "Draft" && cycle
        ? await prisma.interview.findMany({
            where: {
              applicationCycleId: cycle.id,
              status: { in: ["Scheduled", "Completed"] },
              domainApplication: {
                domainId: assignment.domainId,
              },
            },
            include: {
              domainApplication: {
                include: {
                  domain: true,
                  application: {
                    include: {
                      user: { select: { firstName: true, lastName: true } },
                    },
                  },
                },
              },
              assignments: {
                where: { status: "Active" },
                include: {
                  cycleInterviewer: {
                    include: { user: true, domain: true },
                  },
                },
              },
            },
            orderBy: { startTime: "asc" },
          })
        : [];

      // Reviewers for this domain in this cycle
      const reviewers = cycle
        ? await prisma.cycleReviewer.findMany({
            where: { applicationCycleId: cycle.id, domainId: assignment.domainId },
            include: { user: true, domain: true },
          })
        : [];

      // Delibs sessions for this domain+cycle
      const delibsSessions = cycle
        ? await prisma.delibsSession.findMany({
            where: { domainId: assignment.domainId, applicationCycleId: cycle.id },
            orderBy: { createdAt: "desc" },
          })
        : [];

      const daDomainMatch = { domainId: assignment.domainId };

      // Each delib round in the cycle's timeline, with how many of this
      // domain's applicants qualify for its board right now.
      const delibRoundSummaries: DomainRoundSummary[] = cycle
        ? await Promise.all(
            delibRounds(parseTimeline(cycle.timeline)).map(async (r) => ({
              id: r.id,
              label: r.label,
              isFinal: r.isFinal,
              leadsToInterviews: r.leadsToInterviews,
              count: await prisma.domainApplication.count({
                where: {
                  selected: true,
                  ...daDomainMatch,
                  application: { applicationCycleId: cycle.id, ...inReviewPipelineFilter },
                  ...(await delibsQualifier(cycle, r.id, assignment.domainId)),
                },
              }),
            })),
          )
        : [];

      // Compute inferred status for each domain application
      const appsWithStatus = apps.map((app: any) => ({
        ...app,
        domainApplications: app.domainApplications.map((da: any) => ({
          ...da,
          inferredStatus: inferDomainApplicationStatus(
            { ...da, application: { statusUpdates: app.statusUpdates } },
            currentStatus as ApplicationCycleStatus,
          ),
        })),
      }));

      // Draft decisions (for finalization after delibs close)
      const draftDecisions = cycle
        ? await prisma.decision.findMany({
            where: {
              stage: "Draft",
              domainApplication: {
                ...daDomainMatch,
                application: { applicationCycleId: cycle.id },
              },
            },
            include: {
              domainApplication: {
                include: { application: { include: { user: { select: { firstName: true, lastName: true } } } } },
              },
            },
            orderBy: { createdAt: "desc" },
          })
        : [];

      // Cycle reviewers for this domain (for the reviewer assignment picker)
      const cycleReviewersForDomain = cycle
        ? await prisma.cycleReviewer.findMany({
            where: { applicationCycleId: cycle.id, domainId: assignment.domainId },
            include: { user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } } },
          })
        : [];

      // Rubric options — rubrics are not domain-specific, so all rubric versions are eligible.
      const rubricVersionOptions = await prisma.rubricVersion.findMany({
        include: { rubric: { select: { name: true } }, createdBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      });
      const currentRubricVersionId = cycle?.domains[0]?.rubricVersionId ?? null;
      // Flat criteria list for the ReviewModal's score labels, resilient to
      // rubric edits: current domain rubric + general rubric + any versions
      // pinned on this domain's reviews (and their history), so scores keyed by
      // an older rubric version still resolve instead of leaking raw crit-<ts>.
      const domainReviewVersionIds = cycle
        ? (
            await prisma.applicationReview.findMany({
              where: {
                domainApplication: {
                  ...daDomainMatch,
                  application: { applicationCycleId: cycle.id },
                },
                rubricVersionId: { not: null },
              },
              select: { rubricVersionId: true },
              distinct: ["rubricVersionId"],
            })
          ).map((r) => r.rubricVersionId)
        : [];
      const generalCriteria = cycle?.generalRubricVersionId
        ? ((rubricVersionOptions.find((rv) => rv.id === cycle.generalRubricVersionId)
            ?.criteria as any[] | null) ?? undefined)
        : undefined;
      const rubricCriteria = await buildCriteriaList({
        domainRubricVersionId: currentRubricVersionId,
        generalCriteria,
        pinnedVersionIds: domainReviewVersionIds,
      });

      // Interviewers for this domain in this cycle, with the hours their DALI
      // OS calendar leaves free inside the interview window.
      const interviewersRaw = cycle
        ? await prisma.cycleInterviewer.findMany({
            where: { applicationCycleId: cycle.id, domainId: assignment.domainId },
            include: {
              user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } },
            },
          })
        : [];
      const interviewConfig = cycle && cycle.hasInterviews
        ? await prisma.interviewConfig.findUnique({ where: { applicationCycleId: cycle.id } })
        : null;
      const calendars = interviewConfig
        ? await interviewerCalendars(interviewersRaw.map((i) => i.userId), interviewConfig)
        : new Map();
      const interviewers = interviewersRaw.map((i) => {
        const blocks: { startTime: Date; endTime: Date }[] = calendars.get(i.userId)?.available ?? [];
        const totalMs = blocks.reduce((sum, b) => sum + (b.endTime.getTime() - b.startTime.getTime()), 0);
        return {
          ...i,
          availabilityHours: totalMs / (1000 * 60 * 60),
          hasCalendar: calendars.get(i.userId)?.hasCalendar ?? false,
        };
      });
      const hasApplicationReviews = cycle
        ? (await prisma.applicationReview.count({
            where: {
              domainApplication: {
                ...daDomainMatch,
                application: { applicationCycleId: cycle.id },
              },
            },
          })) > 0
        : false;

      // When the user has not signed the cycle's confidentiality agreement,
      // strip every sensitive data path: applicant identities (cycle.applications),
      // assigned applications, scheduled interviews, draft decisions, and delibs
      // sessions. The dashboard still loads so the domain lead can see static
      // setup (challenges, rubric, team, counts that depend only on staff side)
      // and gets a placeholder pointing at the sign page.
      if (confidentialityRequired) {
        const sanitizedCycle = { ...cycle, applications: [] };
        return {
          assignment,
          cycle: sanitizedCycle,
          availableCycles,
          apps: [] as any[],
          linkedChallengeForms,
          isChallengeReady,
          interviews: [] as any[],
          reviewers,
          delibsSessions: [] as any[],
          draftDecisions: [] as any[],
          cycleReviewersForDomain,
          delibRounds: [] as DomainRoundSummary[],
          rubricVersionOptions,
          currentRubricVersionId,
          rubricCriteria,
          interviewers,
          hasApplicationReviews,
          confidentialityRequired,
        };
      }

      return { assignment, cycle, availableCycles, apps: appsWithStatus, linkedChallengeForms, isChallengeReady, interviews, reviewers, delibsSessions, draftDecisions, cycleReviewersForDomain, delibRounds: delibRoundSummaries, rubricVersionOptions, currentRubricVersionId, rubricCriteria, interviewers, hasApplicationReviews, confidentialityRequired: null as null | "no_agreement" | "unsigned" };
      })(activeCycle)];
    })
  );

  return { domainData: domainData.flat(), pillRoles };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Every intent acts on one domain, and only that domain's lead may act.
  const domainId =
    intent === "remove-challenge-form"
      ? (await prisma.cycleDomainForm.findUnique({
          where: { id: String(formData.get("cdfId") ?? "") },
          select: { domainId: true },
        }))?.domainId
      : String(formData.get("domainId") ?? "");
  const lead =
    domainId &&
    (await prisma.domainLeadAssignment.findFirst({ where: { userId: auth.user.sub, domainId }, select: { id: true } }));
  if (!domainId || !lead) return Response.json({ error: "Forbidden" }, { status: 403 });

  if (intent === "add-domain-mentors") {
    const cycleId = String(formData.get("cycleId") ?? "");
    const role = formData.get("role");
    if (role !== "reviewer" && role !== "interviewer") {
      return Response.json({ error: "Unknown role" }, { status: 400 });
    }
    const linked = await prisma.domainApplicationCycle.findUnique({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
      select: { domainId: true },
    });
    if (!linked) return Response.json({ error: "That domain isn't in this cycle" }, { status: 400 });
    const added = await addDomainMentors(cycleId, domainId, role, request);
    // Nothing added means either no mentors, or all of them already on it.
    const notice =
      added > 0
        ? `Added ${added} mentor${added === 1 ? "" : "s"}.`
        : (await domainMentorIds(domainId, request)).length
          ? "Everyone's already on the roster."
          : "This domain has no mentors yet.";
    return { notice };
  }

  if (intent === "set-rubric") {
    const cycleId = formData.get("cycleId") as string;
    const rubricVersionId = (formData.get("rubricVersionId") as string) || null;

    const hasAssignedReviews = await prisma.applicationReview.count({
      where: {
        domainApplication: {
          domainId,
          application: { applicationCycleId: cycleId },
        },
      },
    });
    if (hasAssignedReviews > 0) {
      return redirect("/hiring/domain-lead");
    }

    await prisma.domainApplicationCycle.update({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
      data: { rubricVersionId },
    });
    return redirect("/hiring/domain-lead");
  }

  if (intent === "create-challenge-form") {
    // Auto-create a Drive challenge Form for this domain and link it (Draft only).
    await addDomainChallenge(formData.get("cycleId") as string, domainId, auth.user.sub);
    return redirect("/hiring/domain-lead");
  }

  if (intent === "remove-challenge-form") {
    // Draft only, and refused once an applicant picked a version of the form.
    await removeDomainChallenge(formData.get("cdfId") as string);
    return redirect("/hiring/domain-lead");
  }

  if (intent === "mark-ready" || intent === "unmark-ready") {
    const cycleId = formData.get("cycleId") as string;
    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: cycleId },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return redirect("/hiring/domain-lead");
    }
    const isReady = intent === "mark-ready";
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
      update: { isReady },
      create: { domainId, applicationCycleId: cycleId, isReady },
    });
    return redirect("/hiring/domain-lead");
  }

  return redirect("/hiring/domain-lead");
}

function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = "confirm-dialog-title";
  return (
    <Modal open={open} onClose={onCancel} labelledBy={titleId}>
      <div className="space-y-4">
        <h2 id={titleId} className="text-base font-semibold text-foreground">{title}</h2>
        <div className="text-sm text-muted-foreground">{body}</div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-card hover:bg-muted/50 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 text-sm font-medium rounded-md text-white transition ${destructive ? "bg-red-600 hover:bg-red-700" : "bg-accent-coral hover:bg-accent-coral/90"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function DomainLeadDashboard() {
  const data = useLoaderData<typeof loader>() as any;
  const actionData = useActionData<typeof action>() as { notice?: string } | undefined;
  const toast = useToast();
  const os = useOsChrome();
  const domainData = data?.domainData ?? [];
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (actionData?.notice) toast.success(actionData.notice);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per action result
  }, [actionData]);

  if (domainData.length === 0) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className={os.bodyText}>You don't lead a domain yet.</p>
      </div>
    );
  }

  // One domain at a time; leads of several switch between them.
  const domainParam = searchParams.get("domain");
  const current = domainData.find((d: any) => d.assignment.domainId === domainParam) ?? domainData[0];
  const setDomain = (domainId: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("domain", domainId);
        next.delete("cycle");
        return next;
      },
      { preventScrollReset: true },
    );

  return (
    <div className="flex flex-col gap-6">
      {domainData.length > 1 && (
        <SegmentedTabButtons
          label="Domain"
          items={domainData.map((d: any) => ({
            label: d.assignment.domain.name,
            active: d === current,
            onClick: () => setDomain(d.assignment.domainId),
          }))}
        />
      )}
      <DomainPanel key={`${current.assignment.id}-${current.cycle?.id ?? "none"}`} entry={current} />
    </div>
  );
}

function DomainPanel({ entry }: { entry: any }) {
  const { assignment, cycle, availableCycles, apps, linkedChallengeForms, isChallengeReady, interviews, reviewers: cycleReviewers, delibsSessions, draftDecisions, cycleReviewersForDomain, delibRounds: roundSummaries, rubricVersionOptions, currentRubricVersionId, rubricCriteria, interviewers, hasApplicationReviews, confidentialityRequired } = entry;
  const os = useOsChrome();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const toast = useToast();
  const dialog = useDialog();
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
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

  useEffect(() => {
    // Rosters take current-term members only.
    fetch("/api/members?scope=current", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: any[]) => setMembers(list.map((m) => ({ id: m.id, name: personName(m) ?? m.id }))))
      .catch(() => {});
  }, []);

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

  const currentStatus = cycle.statusUpdates[0]?.newStatus ?? null;
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
        {/* Challenges: editable in Draft, read-only while open or in review. */}
        {currentStatus === "Draft" && cycle.hasChallenges && (
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
                isChallengeReady={isChallengeReady}
              />
            </SetupCard>
          </NavSection>
        )}
        {(currentStatus === "Open" || currentStatus === "UnderReview") && cycle.hasChallenges && (
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
                  <ApplicationsTable
                    apps={reviewApps}
                    draftDecisions={draftDecisions ?? []}
                    cycleReviewersForDomain={cycleReviewersForDomain}
                    cycleId={cycle.id}
                    domainId={assignment.domainId}
                    currentStatus={currentStatus}
                    canAssignReviewers={!!cycle.generalRubricVersionId && (!cycle.hasChallenges || !!currentRubricVersionId)}
                    rubricCriteria={rubricCriteria ?? []}
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
          const canFinalize = currentStatus === "UnderReview";
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
                      location:
                        interview.location === 'PodAppa' ? 'Pod Appa'
                        : interview.location === 'PodMomo' ? 'Pod Momo'
                        : 'Online',
                      zoomJoinUrl: interview.location === 'Online' ? interview.zoomJoinUrl : null,
                      videoUrl: interview.location === 'Online' ? interview.videoUrl : null,
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
                    const url = `/hiring/domain-lead/application/${row.daId}`;
                    const label = row.name || 'Applicant';
                    if (!requestOpenTabIfEmbedded(url, label)) navigate(url);
                  };
                  if (rows.length === 0) return null;
                  return (
                    <div>
                      <div className="hidden sm:block overflow-x-auto border border-border rounded-lg">
                        <table className="w-full text-sm min-w-[900px]">
                          <thead className="bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            <tr>
                              <th className="px-6 py-3 text-left">Applicant</th>
                              <th className="px-6 py-3 text-left">Time</th>
                              <th className="px-6 py-3 text-left">Location</th>
                              <th className="px-6 py-3 text-left">Status</th>
                              <th className="px-6 py-3 text-left">Decisions</th>
                              <th className="px-6 py-3 text-left">In-Domain</th>
                              <th className="px-6 py-3 text-left">Cross-Domain</th>
                              <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {rows.map((row) => (
                              <tr
                                key={row.key}
                                onClick={() => openReview(row)}
                                className={`hover:bg-muted/50 ${row.daId ? "cursor-pointer" : ""}`}
                              >
                                <td className="px-6 py-4 font-medium text-foreground">{row.name}</td>
                                <td className="px-6 py-4 text-muted-foreground">{row.time}</td>
                                <td className="px-6 py-4 text-muted-foreground text-xs">
                                  {row.location}
                                  {(row.videoUrl ?? row.zoomJoinUrl) && (
                                    <a href={row.videoUrl ?? row.zoomJoinUrl ?? ''} target="_blank" rel="noopener noreferrer"
                                       onClick={(e) => e.stopPropagation()}
                                       className="block text-xs text-blue-600 hover:underline mt-0.5">Join Google Meet</a>
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
                            className={`border border-border rounded-lg p-3 space-y-2 ${row.daId ? "cursor-pointer hover:bg-muted/50" : ""}`}
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
                                       className="ml-2 text-blue-600 hover:underline">Join Google Meet</a>
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

function personName(u: any): string | undefined {
  return (u?.firstName && u?.lastName ? `${u.firstName} ${u.lastName}` : u?.daliEmail) ?? undefined;
}

function FreeTime({ hours, hasCalendar }: { hours: number; hasCalendar?: boolean }) {
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

function DraftSection({ cycle, domainId, linkedChallengeForms, isChallengeReady }: {
  cycle: any;
  domainId: string;
  linkedChallengeForms: any[];
  isChallengeReady: boolean;
}) {
  const { bodyText } = useOsChrome();
  const hasLinked = linkedChallengeForms.length > 0;
  const navigation = useNavigation();
  // Creating a challenge form isn't idempotent (each submit makes a new
  // form), so the button is disabled while one is in flight.
  const creatingChallenge =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "create-challenge-form" &&
    navigation.formData?.get("domainId") === domainId;
  const hidden = (intent: string) => (
    <>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="cycleId" value={cycle.id} />
      <input type="hidden" name="domainId" value={domainId} />
    </>
  );

  // Ready: frozen for applicants, still reopenable with Edit challenges.
  if (hasLinked && isChallengeReady) {
    return (
      <>
        <div className="flex flex-col gap-3">
          {linkedChallengeForms.map((cf: any) => (
            <HiringFormEmbed key={cf.id} formId={cf.formId} name={cf.name} questions={cf.questions ?? []} />
          ))}
        </div>
        <Form method="post" preventScrollReset>
          {hidden("unmark-ready")}
          <button type="submit" className={buttonClasses("secondary", "md")}>
            Edit challenges
          </button>
        </Form>
      </>
    );
  }

  return (
    <>
      {hasLinked ? (
        <div className="flex flex-col gap-3">
          {linkedChallengeForms.map((cf: any) => (
            <HiringFormEmbed
              key={cf.id}
              formId={cf.formId}
              name={cf.name}
              questions={cf.questions ?? []}
              defaultOpen={linkedChallengeForms.length === 1}
              remove={{ intent: "remove-challenge-form", fields: { cdfId: cf.id } }}
            />
          ))}
        </div>
      ) : (
        <p className={cn(bodyText, "py-3 text-center")}>No challenge form yet. Add one to author it in Forms.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Form method="post" preventScrollReset>
          {hidden("create-challenge-form")}
          <button type="submit" disabled={creatingChallenge} className={buttonClasses("secondary", "md")}>
            <Plus className="h-4 w-4" aria-hidden />
            {creatingChallenge ? "Adding…" : "Add challenge form"}
          </button>
        </Form>
        {hasLinked && (
          <Form method="post" preventScrollReset>
            {hidden("mark-ready")}
            <Tooltip content="Tells the hiring lead this domain's challenge is set.">
              <button type="submit" className={buttonClasses("primary", "md")}>
                Mark as ready
              </button>
            </Tooltip>
          </Form>
        )}
      </div>
    </>
  );
}

function RubricPicker({ cycleId, domainId, options, selectedId, locked }: {
  cycleId: string;
  domainId: string;
  options: any[];
  selectedId: string | null;
  locked: boolean;
}) {
  const { formTrigger } = useOsChrome();
  const label = (rv: any) =>
    formatVersionLabel({
      name: rv.rubric?.name ?? "Rubric",
      versionNumber: rv.versionNumber,
      createdAt: rv.createdAt,
      createdBy: rv.createdBy,
    });
  const selectedRv = options.find((rv: any) => rv.id === selectedId);
  if (locked) {
    return (
      <DomainSubRow
        label="Rubric"
        value={selectedRv ? label(selectedRv) : <SubRowEmpty>None</SubRowEmpty>}
        action={<Pill>Locked</Pill>}
      />
    );
  }
  return (
    <Form method="post" preventScrollReset key={`rubric-${selectedId}`} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="intent" value="set-rubric" />
      <input type="hidden" name="cycleId" value={cycleId} />
      <input type="hidden" name="domainId" value={domainId} />
      <div className="min-w-0 flex-1">
        <Select
          name="rubricVersionId"
          ariaLabel="Rubric version"
          defaultValue={selectedId ?? ""}
          placeholder="No rubric"
          options={[{ value: "", label: "No rubric" }, ...options.map((rv: any) => ({ value: rv.id as string, label: label(rv) }))]}
          buttonClassName={rowTrigger(formTrigger)}
        />
      </div>
      <button type="submit" className={buttonClasses("primary", "md")}>
        Save
      </button>
    </Form>
  );
}

type DomainRoundSummary = {
  id: string;
  label: string;
  isFinal: boolean;
  leadsToInterviews: boolean;
  /** This domain's applicants who qualify for the round's board now. */
  count: number;
};

// One row per delib round, in timeline order.
function roundPurpose(r: DomainRoundSummary): string {
  if (r.isFinal) return "Accept, waitlist, or reject";
  if (r.leadsToInterviews) return "Decide who interviews";
  return "Decide who moves on";
}

function DelibsSection({ cycleId, domainId, sessions, rounds }: {
  cycleId: string;
  domainId: string;
  sessions: any[];
  rounds: DomainRoundSummary[];
}) {
  const [loading, setLoading] = useState<string | null>(null);

  async function openDelibs(roundId: string) {
    setLoading(roundId);
    const res = await fetch(`/api/hiring/cycles/${cycleId}/delibs`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domainId, roundId }),
    });
    if (res.ok) {
      const session = await res.json();
      window.location.href = `/hiring/domain-lead/delibs/${session.id}`;
    }
    setLoading(null);
  }

  function renderButton(round: DomainRoundSummary, session: any) {
    const count = round.count;
    const countLabel = ` (${count})`;
    if (session?.status === "Active") {
      return (
        <a href={`/hiring/domain-lead/delibs/${session.id}`} className={buttonClasses("primary", "sm")}>
          Continue{countLabel}
        </a>
      );
    }
    const reopen = session?.status === "Closed";
    return (
      <button
        type="button"
        onClick={() => openDelibs(round.id)}
        disabled={loading === round.id || count === 0}
        className={buttonClasses("secondary", "sm")}
      >
        {loading === round.id ? (reopen ? "Reopening…" : "Starting…") : `${reopen ? "Reopen" : "Start"}${countLabel}`}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rounds.map((round) => (
        <div key={round.id} className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">{round.label}</span>
            <span className="text-sm text-os-grey">{roundPurpose(round)}</span>
          </div>
          {renderButton(round, sessions.find((s: any) => s.roundId === round.id))}
        </div>
      ))}
    </div>
  );
}

// Stage treatment composes on top of the `border border-current/40` the badge
// always applies. Draft reads as "tentative" (faded + dashed, same hue);
// Final/Released keep the solid same-hue border.
const STAGE_TREATMENT: Record<DecisionPill["stage"], string> = {
  Draft: "opacity-60",
  Final: "",
  Released: "",
};

const DECISION_TOOLTIPS: Record<DecisionPill["stage"], (typeLabel: string) => string> = {
  Draft: (t) => `Draft ${t} — not yet finalized. Click Finalize to lock in.`,
  Final: (t) => `Final ${t} — decision locked. Will be released to the applicant by the hiring lead.`,
  Released: (t) => `Released ${t} — applicant has been notified.`,
};

function DecisionPillBadge({ pill, isCurrent = false }: { pill: DecisionPill; isCurrent?: boolean }) {
  const baseLabel = DECISION_LABELS[pill.type] ?? pill.type;
  const rankSuffix =
    pill.type === "Waitlisted" && pill.waitlistRank != null
      ? ` #${pill.waitlistRank}`
      : "";
  const stageSuffix = ` (${pill.stage.toLowerCase()})`;
  const tooltip = DECISION_TOOLTIPS[pill.stage](`${baseLabel}${rankSuffix}`);
  // "Current" emphasis ring uses the pill's OWN hue (ring-current = its text
  // color) so it reads as the same color as the border, not a competing gray
  // ring sitting just outside a red/green/etc. border.
  const accent = isCurrent ? "ring-2 ring-offset-1 ring-current/60" : "";
  return (
    <Tooltip content={tooltip} variant="rich">
      <span aria-label={tooltip} className={cn("inline-flex rounded-full", STAGE_TREATMENT[pill.stage], accent)}>
        <Pill dot={DECISION_TONES[pill.type] ?? "neutral"}>
          {baseLabel}{rankSuffix}{stageSuffix}
        </Pill>
      </span>
    </Tooltip>
  );
}

const PRE_PIPELINE_LABELS: Record<PrePipelinePill, string> = {
  Reviewing: "Reviewing",
  InterviewScheduled: "Interview scheduled",
  PostInterview: "Post-interview",
};

const PRE_PIPELINE_TOOLTIPS: Record<PrePipelinePill, string> = {
  Reviewing: "Reviewers are evaluating this application. No decision has been made yet.",
  InterviewScheduled: "Applicant has booked an interview. Decision is pending until after the interview.",
  PostInterview: "Interview is complete. Waiting on final delibs to decide.",
};

function PrePipelinePillBadge({ pill }: { pill: PrePipelinePill }) {
  return (
    <Tooltip content={PRE_PIPELINE_TOOLTIPS[pill]} variant="rich">
      <span aria-label={PRE_PIPELINE_TOOLTIPS[pill]} className="inline-flex">
        <Pill dot="neutral">{PRE_PIPELINE_LABELS[pill]}</Pill>
      </span>
    </Tooltip>
  );
}

function ApplicationsTable({ apps, draftDecisions, cycleReviewersForDomain, cycleId, domainId, currentStatus, canAssignReviewers, rubricCriteria }: {
  apps: any[];
  draftDecisions: any[];
  cycleReviewersForDomain: any[];
  cycleId: string;
  domainId: string;
  currentStatus: string;
  canAssignReviewers: boolean;
  rubricCriteria: any[];
}) {
  const toast = useToast();
  const isUnderReview = currentStatus === "UnderReview";
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  // Which draft is currently being finalized — disables its Finalize button so a
  // double-click can't POST twice (the append-only Decision model would otherwise
  // create duplicate Final rows before the revalidate lands).
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const handleFinalize = async (draftId: string) => {
    if (finalizingId) return;
    setFinalizingId(draftId);
    try {
      const res = await fetch(`/api/hiring/decisions/${draftId}/finalize`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Failed to finalize. Please try again.");
      }
    } finally {
      setFinalizingId(null);
      revalidator.revalidate();
    }
  };
  const filter: "all" | "finalize" = searchParams.get("app_filter") === "finalize" ? "finalize" : "all";
  const query = searchParams.get("q") ?? "";
  // Default sort is "none" — preserves the loader's order (newest application
  // first). Users opt into name/reviewer sort by clicking a column header.
  const sortParam = searchParams.get("sort");
  const sortKey: "none" | "name" | "reviewers" =
    sortParam === "name" ? "name" : sortParam === "reviewers" ? "reviewers" : "none";
  const sortDir: "asc" | "desc" = searchParams.get("dir") === "desc" ? "desc" : "asc";

  const updateParam = (key: string, value: string | null) => {
    setSearchParams(prev => {
      const sp = new URLSearchParams(prev);
      if (!value) sp.delete(key);
      else sp.set(key, value);
      return sp;
    }, { preventScrollReset: true });
  };
  const setFilter = (next: "all" | "finalize") => updateParam("app_filter", next === "all" ? null : next);
  const setQuery = (next: string) => updateParam("q", next.trim() === "" ? null : next);
  const toggleSort = (key: "name" | "reviewers") => {
    if (sortKey === key) {
      // Second click on the active column flips direction; a third click clears
      // the sort and returns to loader order.
      if (sortDir === "asc") {
        updateParam("dir", "desc");
      } else {
        setSearchParams(prev => {
          const sp = new URLSearchParams(prev);
          sp.delete("sort");
          sp.delete("dir");
          return sp;
        }, { preventScrollReset: true });
      }
    } else {
      setSearchParams(prev => {
        const sp = new URLSearchParams(prev);
        sp.set("sort", key);
        sp.delete("dir");
        return sp;
      }, { preventScrollReset: true });
    }
  };

  const draftDecisionAppIds = new Set(
    draftDecisions
      .filter((d: any) => {
        const da = apps.flatMap((a: any) => a.domainApplications).find((da: any) => da?.id === d.domainApplicationId);
        if (!da) return false;
        const hasFinal = (da.decisions ?? []).some((dec: any) => dec.stage === "Final");
        return !hasFinal;
      })
      .map((d: any) => {
        const da = apps.flatMap((a: any) => a.domainApplications).find((da: any) => da?.id === d.domainApplicationId);
        return da?.applicationId;
      })
      .filter(Boolean),
  );

  const finalizableApps = apps.filter((app: any) => {
    const da = app.domainApplications[0];
    if (!da) return false;
    const decisions = da.decisions ?? [];
    return decisions.some((d: any) => {
      if (d.stage !== "Draft") return false;
      return !decisions.some(
        (other: any) => other.type === d.type && (other.stage === "Final" || other.stage === "Released")
      );
    });
  });

  const baseApps = filter === "finalize" ? finalizableApps : apps;
  const lowerQuery = query.trim().toLowerCase();
  const filteredApps = lowerQuery === ""
    ? baseApps
    : baseApps.filter((app: any) => {
        const name = `${app.user.firstName ?? ""} ${app.user.lastName ?? ""}`.toLowerCase();
        return name.includes(lowerQuery);
      });
  const reviewerScore = (app: any) => {
    const reviews = app.domainApplications?.[0]?.reviews ?? [];
    const submitted = reviews.filter((r: any) => r.submittedAt).length;
    return submitted * 10000 + reviews.length;
  };
  const sortedApps = sortKey === "none"
    ? filteredApps
    : [...filteredApps].sort((a: any, b: any) => {
        let cmp = 0;
        if (sortKey === "name") {
          const an = `${a.user.firstName ?? ""} ${a.user.lastName ?? ""}`.toLowerCase();
          const bn = `${b.user.firstName ?? ""} ${b.user.lastName ?? ""}`.toLowerCase();
          cmp = an.localeCompare(bn);
        } else {
          cmp = reviewerScore(a) - reviewerScore(b);
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
  const displayedApps = sortedApps;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 sm:px-6 py-3 border-b border-border bg-muted/30 flex flex-wrap items-center gap-x-3 gap-y-2">
        {isUnderReview && (
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                filter === "all" ? "bg-accent-coral text-white shadow-sm" : "text-muted-foreground hover:text-foreground/80"
              }`}
            >
              All Applicants ({apps.length})
            </button>
            <button
              onClick={() => setFilter("finalize")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                filter === "finalize" ? "bg-accent-coral text-white shadow-sm" : "text-muted-foreground hover:text-foreground/80"
              }`}
            >
              Needs Finalization ({finalizableApps.length})
            </button>
          </div>
        )}
        <SearchInput
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search applicants..."
          aria-label="Search applicants by name"
          size="sm"
          containerClassName="flex-1 min-w-[12rem] max-w-xs"
        />
        {(query || sortKey !== "none") && (
          <button
            type="button"
            onClick={() => {
              setSearchParams(prev => {
                const sp = new URLSearchParams(prev);
                sp.delete("q");
                sp.delete("sort");
                sp.delete("dir");
                return sp;
              }, { preventScrollReset: true });
            }}
            className="text-xs text-muted-foreground hover:text-foreground/80"
          >
            Reset
          </button>
        )}
        <span className="text-xs text-muted-foreground">
          {displayedApps.length} of {baseApps.length}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {isUnderReview && filter === "finalize" && finalizableApps.length > 0 && (
            <button
              onClick={async () => {
                for (const app of finalizableApps) {
                  const da = app.domainApplications[0];
                  const allDecisions = da?.decisions ?? [];
                  const draft = allDecisions.find((d: any) => {
                    if (d.stage !== "Draft") return false;
                    return !allDecisions.some(
                      (other: any) => other.type === d.type && (other.stage === "Final" || other.stage === "Released")
                    );
                  });
                  if (draft) {
                    await fetch(`/api/hiring/decisions/${draft.id}/finalize`, { method: "POST", credentials: "include" });
                  }
                }
                revalidator.revalidate();
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent-coral hover:bg-accent-coral/90 text-white transition"
            >
              Finalize All ({finalizableApps.length})
            </button>
          )}
          {currentStatus === "UnderReview" && (
            <Tooltip
              content={
                !canAssignReviewers
                  ? "A rubric must be set before reviewers can be auto-assigned to applications."
                  : cycleReviewersForDomain.length === 0
                    ? "Add reviewers to this domain first."
                    : null
              }
              variant="rich"
            >
              <span>
                <button
                  onClick={async () => {
                    const res = await fetch(`/api/hiring/cycles/${cycleId}/domains/${domainId}/auto-assign`, {
                      method: "POST", credentials: "include",
                    });
                    if (res.ok) {
                      revalidator.revalidate();
                    } else {
                      const body = await res.json().catch(() => ({}));
                      toast.error(body.error ?? "Auto-assign failed. Check that rubrics are set and reviewers are added.");
                    }
                  }}
                  disabled={!canAssignReviewers || cycleReviewersForDomain.length === 0}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-muted hover:bg-muted/70 text-foreground border border-border transition disabled:opacity-50"
                >
                  Auto-Assign Reviewers
                </button>
              </span>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="hidden sm:block overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <tr>
            <th className="px-6 py-3 text-left">
              <button
                type="button"
                onClick={() => toggleSort("name")}
                className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground/80"
                aria-label={`Sort by applicant name (${sortKey === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "not sorted"})`}
              >
                Applicant
                {sortKey === "name" && (sortDir === "asc"
                  ? <ChevronUp className="w-3 h-3" />
                  : <ChevronDown className="w-3 h-3" />)}
              </button>
            </th>
            <th className="px-6 py-3 text-left">
              <button
                type="button"
                onClick={() => toggleSort("reviewers")}
                className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground/80"
                aria-label={`Sort by reviewer progress (${sortKey === "reviewers" ? (sortDir === "asc" ? "ascending" : "descending") : "not sorted"})`}
              >
                Reviewers
                {sortKey === "reviewers" && (sortDir === "asc"
                  ? <ChevronUp className="w-3 h-3" />
                  : <ChevronDown className="w-3 h-3" />)}
              </button>
            </th>
            <th className="px-6 py-3 text-left">
              <span className="inline-flex items-center gap-1">
                Decisions
                <InfoTip content="Pre-pipeline pills show where this application stands before a formal decision — Reviewing, Interview scheduled, or Post-interview. Formal decision pills (Draft → Final → Released) appear once a decision is made." />
              </span>
            </th>
            <th className="px-6 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {displayedApps.map((app: any) => {
            const da = app.domainApplications[0];
            const reviews = da?.reviews ?? [];
            const decisions = da?.decisions ?? [];
            const draftToFinalize = decisions.find((d: any) => {
              if (d.stage !== "Draft") return false;
              return !decisions.some(
                (other: any) => other.type === d.type && (other.stage === "Final" || other.stage === "Released")
              );
            });
            const pills = da
              ? summarizeDecisionPills({ decisions })
              : [];
            const currentId = currentDecisionId(decisions);
            const prePill = da && pills.length === 0
              ? synthesizePrePipelinePill({
                  application: { statusUpdates: app.statusUpdates ?? [] },
                  interviews: da.interviews ?? [],
                  decisions,
                })
              : null;
            const daId = da?.id as string | undefined;
            return (
              <tr key={app.id} className="hover:bg-muted/50">
                <td className="px-6 py-4 font-medium">
                  {daId ? (
                    <Link
                      to={`/hiring/domain-lead/application/${daId}`}
                      onClick={(e) => {
                        const url = `/hiring/domain-lead/application/${daId}`
                        const label = `${app.user.firstName ?? ''} ${app.user.lastName ?? ''}`.trim() || 'Applicant'
                        if (requestOpenTabIfEmbedded(url, label)) e.preventDefault()
                      }}
                      className="text-foreground hover:text-accent-coral hover:underline"
                    >
                      {app.user.firstName} {app.user.lastName}
                    </Link>
                  ) : (
                    <span className="text-foreground">{app.user.firstName} {app.user.lastName}</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <ReviewerAssignmentCell
                    domainApplicationId={da?.id}
                    reviews={reviews}
                    cycleReviewers={cycleReviewersForDomain}
                    editable={isUnderReview && canAssignReviewers}
                    rubricCriteria={rubricCriteria}
                  />
                </td>
                <td className="px-6 py-4">
                  {pills.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {pills.map((pill, i) => (
                        <DecisionPillBadge key={i} pill={pill} isCurrent={!!pill.id && pill.id === currentId} />
                      ))}
                    </div>
                  ) : prePill ? (
                    <PrePipelinePillBadge pill={prePill} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                  {isUnderReview && draftToFinalize ? (
                    <button
                      onClick={() => handleFinalize(draftToFinalize.id)}
                      disabled={finalizingId === draftToFinalize.id}
                      className="px-2 py-1 text-xs font-medium rounded bg-accent-coral hover:bg-accent-coral/90 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {finalizingId === draftToFinalize.id ? "Finalizing…" : "Finalize"}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">—</span>
                  )}
                  </div>
                </td>
              </tr>
            );
          })}
          {displayedApps.length === 0 && (
            <tr><td colSpan={isUnderReview && canAssignReviewers ? 5 : 4} className="px-6 py-8 text-center text-muted-foreground/70 text-sm">
              {filter === "finalize" ? "No applications need finalization." : "No applications."}
            </td></tr>
          )}
        </tbody>
      </table>
      </div>
      <ul className="sm:hidden divide-y divide-gray-100">
        {displayedApps.map((app: any) => {
          const da = app.domainApplications[0];
          const reviews = da?.reviews ?? [];
          const decisions = da?.decisions ?? [];
          const draftToFinalize = decisions.find((d: any) => {
            if (d.stage !== "Draft") return false;
            return !decisions.some(
              (other: any) => other.type === d.type && (other.stage === "Final" || other.stage === "Released")
            );
          });
          const pills = da
            ? summarizeDecisionPills({ decisions })
            : [];
          const currentId = currentDecisionId(decisions);
          const prePill = da && pills.length === 0
            ? synthesizePrePipelinePill({
                application: { statusUpdates: app.statusUpdates ?? [] },
                interviews: da.interviews ?? [],
                decisions,
              })
            : null;
          const daId = da?.id as string | undefined;
          return (
            <li key={app.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                {daId ? (
                  <Link
                    to={`/hiring/domain-lead/application/${daId}`}
                    onClick={(e) => {
                      const url = `/hiring/domain-lead/application/${daId}`
                      const label = `${app.user.firstName ?? ''} ${app.user.lastName ?? ''}`.trim() || 'Applicant'
                      if (requestOpenTabIfEmbedded(url, label)) e.preventDefault()
                    }}
                    className="font-medium text-foreground hover:text-accent-coral hover:underline"
                  >
                    {app.user.firstName} {app.user.lastName}
                  </Link>
                ) : (
                  <div className="font-medium text-foreground">
                    {app.user.firstName} {app.user.lastName}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Reviewers</div>
                <ReviewerAssignmentCell
                  domainApplicationId={da?.id}
                  reviews={reviews}
                  cycleReviewers={cycleReviewersForDomain}
                  editable={isUnderReview && canAssignReviewers}
                  rubricCriteria={rubricCriteria}
                />
              </div>
              <div>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Decisions</div>
                {pills.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {pills.map((pill, i) => (
                      <DecisionPillBadge key={i} pill={pill} isCurrent={!!pill.id && pill.id === currentId} />
                    ))}
                  </div>
                ) : prePill ? (
                  <PrePipelinePillBadge pill={prePill} />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              {isUnderReview && draftToFinalize && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleFinalize(draftToFinalize.id)}
                    disabled={finalizingId === draftToFinalize.id}
                    className="px-2 py-1 text-xs font-medium rounded bg-accent-coral hover:bg-accent-coral/90 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {finalizingId === draftToFinalize.id ? "Finalizing…" : "Finalize"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {displayedApps.length === 0 && (
          <li className="px-6 py-8 text-center text-muted-foreground/70 text-sm">
            {filter === "finalize" ? "No applications need finalization." : "No applications."}
          </li>
        )}
      </ul>
    </div>
  );
}

function ReviewerAssignmentCell({ domainApplicationId, reviews, cycleReviewers, editable = true, rubricCriteria = [] }: {
  domainApplicationId: string | undefined;
  reviews: any[];
  cycleReviewers: any[];
  editable?: boolean;
  rubricCriteria?: any[];
}) {
  const toast = useToast();
  const [localReviews, setLocalReviews] = useState(reviews);
  const [adding, setAdding] = useState(false);
  const [selectedReviewerId, setSelectedReviewerId] = useState("");
  const [openReview, setOpenReview] = useState<any | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pendingRemoveReview, setPendingRemoveReview] = useState<any | null>(null);

  // Resync from props after the loader revalidates (e.g. when bulk auto-assign
  // adds reviewers to this row). Without this, the pills shown here would lag
  // behind server state until a hard reload.
  useEffect(() => { setLocalReviews(reviews); }, [reviews]);

  const assignedReviewerIds = new Set(localReviews.map((r: any) => r.cycleReviewerId));
  const available = cycleReviewers.filter((cr: any) => !assignedReviewerIds.has(cr.id));

  async function addReviewer() {
    if (!domainApplicationId || !selectedReviewerId) return;
    try {
      const res = await fetch(`/api/hiring/domain-applications/${domainApplicationId}/reviews`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleReviewerId: selectedReviewerId }),
      });
      if (res.ok) {
        const review = await res.json();
        const reviewer = cycleReviewers.find((cr: any) => cr.id === selectedReviewerId);
        setLocalReviews(prev => [...prev, { ...review, cycleReviewer: reviewer }]);
        setSelectedReviewerId("");
        setAdding(false);
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to add reviewer:", res.status, err);
        toast.error(`Failed to add reviewer: ${err.error ?? res.statusText}`);
      }
    } catch (e) {
      console.error("Failed to add reviewer:", e);
    }
  }

  async function performRemoveReview(reviewId: string) {
    setRemoving(reviewId);
    try {
      const res = await fetch(`/api/hiring/reviews/${reviewId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setLocalReviews(prev => prev.filter(r => r.id !== reviewId));
      } else {
        const err = await res.json().catch(() => ({}));
        console.error("Failed to remove review:", res.status, err);
        toast.error(`Failed to remove reviewer: ${err.error ?? res.statusText}`);
      }
    } catch (e) {
      console.error("Failed to remove review:", e);
      toast.error(`Failed to remove reviewer: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRemoving(null);
    }
  }

  function requestRemoveReview(review: any) {
    setPendingRemoveReview(review);
  }

  const cellClass = editable && adding
    ? "flex flex-wrap items-center gap-1 border-2 border-blue-400/50 bg-blue-50 dark:bg-blue-900/20 rounded-md p-1"
    : "flex flex-wrap items-center gap-1";
  return (
    <div className={cellClass}>
      {localReviews.map((r: any) => {
        const m = r.cycleReviewer?.user;
        const name = m?.firstName && m?.lastName
          ? `${m.firstName} ${m.lastName[0]}.`
          : m?.daliEmail ?? "?";
        const fullName = m?.firstName && m?.lastName
          ? `${m.firstName} ${m.lastName}`
          : m?.daliEmail ?? "Reviewer";
        const status = getReviewStatus(r);
        const dot: PillTone =
          status === "submitted" ? "success" : status === "inProgress" ? "warning" : "neutral";
        const recommendation = r.overallRecommendation ? `, recommends ${r.overallRecommendation.toLowerCase()}` : "";
        const tooltip =
          status === "submitted"
            ? `${fullName} — submitted${recommendation}. Click to view scores and feedback.`
            : status === "inProgress"
              ? `${fullName} — review in progress. Click to view partial scores.`
              : `${fullName} — assigned but not started yet.`;
        return (
          <Tooltip key={r.id} content={tooltip} variant="rich">
          <span
            role="button"
            tabIndex={0}
            onClick={() => setOpenReview(r)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpenReview(r);
              }
            }}
            aria-label={tooltip}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full transition hover:brightness-95"
          >
            <Pill dot={dot}>
            {name}
            {editable && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  requestRemoveReview(r);
                }}
                disabled={removing === r.id}
                className="ml-0.5 text-muted-foreground/70 hover:text-red-500 transition"
                aria-label={status === "submitted" ? "Remove reviewer (deletes submitted review)" : "Remove reviewer"}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
            </Pill>
          </span>
          </Tooltip>
        );
      })}
      {editable && adding ? (
        <div className="inline-flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide font-bold text-blue-700 dark:text-blue-300">
            Adding reviewer
          </span>
          <Select
            value={selectedReviewerId}
            placeholder="Select..."
            onChange={(v) => setSelectedReviewerId(v)}
            options={available.map((cr: any) => {
              const m = cr.user;
              return {
                value: cr.id as string,
                label: m?.firstName && m?.lastName
                  ? `${m.firstName} ${m.lastName}`
                  : m?.daliEmail ?? cr.id,
              };
            })}
            buttonClassName="rounded border border-border bg-card text-card-foreground px-1.5 py-0.5 text-xs inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
          <button
            onClick={addReviewer}
            disabled={!selectedReviewerId}
            className="px-1.5 py-0.5 text-xs font-medium rounded bg-accent-teal text-white hover:bg-accent-teal/90 disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setSelectedReviewerId(""); }}
            className="px-1.5 py-0.5 text-xs font-medium rounded border border-border bg-card text-foreground hover:bg-muted/50"
          >
            Cancel
          </button>
        </div>
      ) : editable ? (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs border border-dashed border-gray-300 text-muted-foreground/70 hover:border-blue-400 hover:text-blue-600 transition"
          title="Add reviewer"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      ) : null}
      {openReview && (
        <ReviewModal
          review={openReview}
          rubricCriteria={rubricCriteria}
          onClose={() => setOpenReview(null)}
        />
      )}
      <ConfirmDialog
        open={!!pendingRemoveReview}
        title={
          pendingRemoveReview && getReviewStatus(pendingRemoveReview) === "submitted"
            ? "Remove this reviewer's submitted review?"
            : "Remove this reviewer's in-progress review?"
        }
        body={
          <p>
            <strong>
              {(() => {
                const m = pendingRemoveReview?.cycleReviewer?.user;
                if (!m) return "This reviewer";
                return m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : (m.daliEmail ?? "This reviewer");
              })()}
            </strong>{" "}
            {pendingRemoveReview && getReviewStatus(pendingRemoveReview) === "submitted"
              ? "has already submitted their review. Removing them will permanently delete their scores and feedback."
              : "has a review in progress. Discards their in-progress review."}
          </p>
        }
        confirmLabel={
          pendingRemoveReview && getReviewStatus(pendingRemoveReview) === "submitted"
            ? "Remove and delete review"
            : "Discard review"
        }
        destructive
        onCancel={() => setPendingRemoveReview(null)}
        onConfirm={() => {
          const r = pendingRemoveReview;
          setPendingRemoveReview(null);
          if (r) performRemoveReview(r.id);
        }}
      />
    </div>
  );
}

function ReviewModal({ review, rubricCriteria, onClose }: {
  review: any;
  rubricCriteria: any[];
  onClose: () => void;
}) {
  const m = review.cycleReviewer?.user;
  const reviewerName = m?.firstName && m?.lastName
    ? `${m.firstName} ${m.lastName}`
    : m?.daliEmail ?? "Reviewer";
  const isSubmitted = !!review.submittedAt;
  const scoreEntries = Object.entries((review.scores as Record<string, number>) ?? {});
  const criteriaByKey: Record<string, { label: string; description?: string; maxScore?: number }> = {};
  for (const c of rubricCriteria ?? []) {
    if (c?.key) criteriaByKey[c.key] = { label: c.label ?? c.key, description: c.description, maxScore: c.maxScore };
  }

  const hasAnyContent =
    scoreEntries.length > 0 ||
    (review.feedback && review.feedback.trim() !== "") ||
    (review.rejectionRationale && review.rejectionRationale.trim() !== "") ||
    !!review.overallRecommendation;

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="reviewer-detail-title"
      containerClassName="relative bg-card rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto my-auto"
    >
      <>
        <div className="flex items-start justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 id="reviewer-detail-title" className="text-lg font-semibold text-foreground">{reviewerName}</h2>
            <div className="mt-1 flex items-center gap-2 text-xs">
              {isSubmitted ? (
                <Pill dot="success">
                  Submitted
                  {review.submittedAt && (
                    <> · {new Date(review.submittedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</>
                  )}
                </Pill>
              ) : (
                <Pill dot="warning">In progress</Pill>
              )}
              {review.overallRecommendation && (
                <Pill dot={RECOMMENDATION_TONES[review.overallRecommendation] ?? "neutral"}>
                  {review.overallRecommendation}
                </Pill>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
            aria-label="Close"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {!hasAnyContent ? (
            <p className="text-sm text-muted-foreground italic">
              This reviewer hasn&apos;t started their review yet.
            </p>
          ) : (
            <>
              {review.overallRecommendation && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Recommendation
                  </h3>
                  <Pill dot={RECOMMENDATION_TONES[review.overallRecommendation] ?? "neutral"}>
                    {review.overallRecommendation}
                  </Pill>
                </div>
              )}
              {scoreEntries.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Scores
                  </h3>
                  <div className="space-y-2">
                    {scoreEntries.map(([key, score]) => {
                      const criterion = criteriaByKey[key];
                      return (
                        <div key={key} className="bg-muted/50 rounded px-3 py-2">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-foreground/80">
                              {criterion?.label ?? key}
                            </span>
                            <span className="font-semibold text-foreground whitespace-nowrap">
                              {score}
                              {criterion?.maxScore != null && (
                                <span className="font-normal text-muted-foreground"> / {criterion.maxScore}</span>
                              )}
                            </span>
                          </div>
                          {criterion?.description && (
                            <p className="mt-1 text-xs text-muted-foreground">{criterion.description}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {review.feedback && review.feedback.trim() !== "" && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Feedback
                  </h3>
                  <p className="text-sm text-foreground whitespace-pre-wrap bg-muted/50 rounded p-3">
                    {review.feedback}
                  </p>
                </div>
              )}
              {review.rejectionRationale && review.rejectionRationale.trim() !== "" && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Rejection rationale
                  </h3>
                  <p className="text-sm text-foreground whitespace-pre-wrap bg-muted/50 rounded p-3">
                    {review.rejectionRationale}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </>
    </Modal>
  );
}

