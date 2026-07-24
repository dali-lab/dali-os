import { redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/applications.$domainApplicationId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import { requirePageSignedOrRedirect } from "~/hiring/lib/confidentiality";
import { presignAnswers } from "~/hiring/lib/presign";
import { ApplicationViewer } from "~/hiring/components/ApplicationViewer";
import { ReviewSummary } from "~/hiring/components/ReviewSummary";
import { DetailCard } from "~/hiring/components/DetailCard";
import { ApplicantDetailHeader } from "~/hiring/components/ApplicantDetailHeader";
import {
  InterviewNotesCard,
  type InterviewNotesData,
} from "~/hiring/components/InterviewNotesCard";
import { DecisionHistoryList } from "~/hiring/components/DecisionHistoryList";
import { getEducationEngagement } from "~/education/lib/engagement.server";
import { EducationEngagementPanel } from "~/education/components/EducationEngagementPanel";
import type { Question, RubricCriterion } from "~/types";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as { applicantName?: string } | undefined)?.applicantName;
  return [{ title: `${name ?? "Application"} · Applications · DALI OS` }];
};

// Resolves the dynamic leaf crumb so the trail reads
// "Hiring › Applications › <applicant name>" instead of a raw id.
export const handle = {
  breadcrumb: (data: unknown) =>
    (data as { applicantName?: string } | undefined)?.applicantName ?? null,
};

// Read-only view of one (applicant, domain) submission with a selectable
// reviewer-review viewer. Reachable from the Applications database list.
//
// Access mirrors the list: Core/Admin can open any domain application;
// reviewers only domain applications in domains they're assigned to for the
// cycle. Both gated by the cycle's confidentiality agreement.
//
// Reviews shown here are SUBMITTED reviews only (submittedAt set), rendered
// fully read-only — the page never lets you edit someone else's review.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "dartmouth") return redirect("/portal");

  const da = await prisma.domainApplication.findUnique({
    where: { id: params.domainApplicationId },
    select: {
      id: true,
      domainId: true,
      answers: true,
      // Free-form note leads write during Initial delibs as interview prep.
      // The collab layer keeps this column in sync with the live Yjs doc, so
      // reading it directly is safe. Lead-only on the UI.
      interviewPrepNote: true,
      domain: { select: { displayName: true } },
      challengeVersion: {
        select: {
          questions: true,
          description: true,
          domain: { select: { id: true, name: true, displayName: true } },
          challenge: { select: { name: true } },
        },
      },
      application: {
        select: {
          id: true,
          answers: true,
          applicationCycleId: true,
          generalChallengeVersion: { select: { questions: true, description: true } },
          internToFullFormVersion: { select: { questions: true } },
          applicationCycle: {
            select: {
              name: true,
              cycleType: true,
              generalRubricVersion: { select: { criteria: true } },
              domains: { select: { domainId: true, rubricVersion: { select: { criteria: true } } } },
            },
          },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!da) return redirect("/hiring/applications");

  const cycleId = da.application.applicationCycleId;
  const effectiveDomainId = da.domainId; // always set (backfilled)

  // Access: Core/Admin and domain leads see every domain (matching the
  // analytics + list views). A plain reviewer sees only the domains they
  // cover for this cycle — hitting a URL outside their domain bounces back
  // to the list rather than leaking content.
  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore && !roles.isDomainLead) {
    const assigned = await prisma.cycleReviewer.findFirst({
      where: {
        userId: auth.user.sub,
        applicationCycleId: cycleId,
        domainId: effectiveDomainId,
      },
      select: { id: true },
    });
    if (!assigned) return redirect("/hiring/applications");
  }

  // Confidentiality gate — redirects to the signing page when unsigned.
  const confRedirect = await requirePageSignedOrRedirect(auth.user.sub, cycleId, request);
  if (confRedirect) return confRedirect;

  const isInternToFull = da.application.applicationCycle.cycleType === "InternToFull";

  // Presign file answers so the viewer renders download links, not S3 keys.
  const generalQuestions = isInternToFull
    ? ((da.application.internToFullFormVersion?.questions as unknown as Question[]) ?? [])
    : ((da.application.generalChallengeVersion?.questions as unknown as Question[]) ?? []);
  const [generalAnswers, domainAnswers] = await Promise.all([
    presignAnswers(generalQuestions, da.application.answers as Record<string, string>),
    presignAnswers(
      (da.challengeVersion?.questions as unknown as Question[]) ?? [],
      da.answers as Record<string, string>,
    ),
  ]);

  // Question labels for the viewer (general + this domain's challenge).
  const questionLabels: Record<string, string> = {};
  for (const q of generalQuestions) questionLabels[q.key] = q.data.label;
  for (const q of (da.challengeVersion?.questions as unknown as Question[]) ?? []) {
    questionLabels[q.key] = q.data.label;
  }

  // Criterion labels for the Scores list: the cycle's general rubric plus this
  // domain's rubric. Scores are keyed by criterion key (e.g. "crit-1778..."),
  // so without this map the page renders the raw keys.
  const cycle = da.application.applicationCycle;
  const criterionLabels: Record<string, string> = {};
  const generalCriteria =
    (cycle.generalRubricVersion?.criteria as unknown as RubricCriterion[]) ?? [];
  const domainCriteria =
    (cycle.domains.find((d) => d.domainId === effectiveDomainId)?.rubricVersion
      ?.criteria as unknown as RubricCriterion[]) ?? [];
  for (const c of [...generalCriteria, ...domainCriteria]) {
    criterionLabels[c.key] = c.label;
  }

  // Per-section role flags. Page-level access (above) already restricts plain
  // reviewers to DAs in their own domain; these flags further gate
  // pre-Released decisions and delibs context to leads only.
  const canSeePreReleaseDecisions = roles.isCore || roles.isDomainLead;
  const canSeeDelibs = roles.isCore || roles.isDomainLead;

  // Submitted reviews, interviews (+ assignments + latest note per assignment),
  // decisions, and delibs sessions for this DA — all in parallel.
  const [reviewRows, interviewRows, decisionRows, delibsSessions] = await Promise.all([
    prisma.applicationReview.findMany({
      where: { domainApplicationId: da.id, submittedAt: { not: null } },
      orderBy: { submittedAt: "asc" },
      select: {
        id: true,
        scores: true,
        feedback: true,
        rejectionRationale: true,
        overallRecommendation: true,
        annotations: true,
        submittedAt: true,
        submittedBy: { select: { firstName: true, lastName: true, photoUrl: true } },
      },
    }),
    prisma.interview.findMany({
      where: { domainApplicationId: da.id },
      orderBy: { startTime: "asc" },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
        location: true,
        zoomJoinUrl: true,
        // Joint outcome — synced from `interview:{id}:recommendation` doc.
        recommendation: true,
        recommendationNotes: true,
        assignments: {
          where: { status: "Active" },
          select: {
            id: true,
            role: true,
            cycleInterviewer: {
              select: {
                userId: true,
                user: { select: { firstName: true, lastName: true } },
                domain: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    // Decisions are append-only. We fetch all rows; visibility per stage is
    // gated in the response shaping below.
    prisma.decision.findMany({
      where: { domainApplicationId: da.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        stage: true,
        notes: true,
        waitlistRank: true,
        createdAt: true,
        madeBy: { select: { firstName: true, lastName: true } },
      },
    }),
    // Delibs sessions reference DAs by id inside columnOrder JSON, not by FK.
    // There's at most one Initial + one Final session per (domain, cycle), so
    // this is bounded.
    canSeeDelibs
      ? prisma.delibsSession.findMany({
          where: { domainId: effectiveDomainId, applicationCycleId: cycleId },
          select: {
            id: true,
            type: true,
            status: true,
            columnOrder: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([] as Array<{
          id: string;
          type: "Initial" | "Final";
          status: "Active" | "Closed";
          columnOrder: unknown;
          createdAt: Date;
          updatedAt: Date;
        }>),
  ]);
  const reviews = await Promise.all(
    reviewRows.map(async (r) => ({
      id: r.id,
      reviewerName:
        [r.submittedBy?.firstName, r.submittedBy?.lastName].filter(Boolean).join(" ").trim() ||
        "Reviewer",
      reviewerPhotoUrl: await resolvePhotoUrl(r.submittedBy?.photoUrl),
      scores: r.scores as Record<string, number>,
      feedback: r.feedback,
      rejectionRationale: r.rejectionRationale,
      overallRecommendation: r.overallRecommendation,
      annotations: (r.annotations as object[]) ?? [],
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    })),
  );

  // Interview notes live in CollabDocumentVersion (Yjs/Tiptap), not in the
  // legacy InterviewNoteVersion table. There are two doc kinds per interview:
  //   interview:{id}:notes                          — joint, shared by both
  //                                                   interviewers
  //   interview:{id}:rec-notes-{assignmentId}       — per-interviewer private
  //                                                   recommendation notes
  // Joint recommendation text is synced from `interview:{id}:recommendation`
  // back to Interview.recommendationNotes, so we read that column directly.
  const collabDocNames: string[] = [];
  for (const iv of interviewRows) {
    collabDocNames.push(`interview:${iv.id}:notes`);
    if (canSeePreReleaseDecisions) {
      for (const a of iv.assignments) {
        collabDocNames.push(`interview:${iv.id}:rec-notes-${a.id}`);
      }
    }
  }
  const collabVersionRows = collabDocNames.length > 0
    ? await prisma.collabDocumentVersion.findMany({
        where: { name: { in: collabDocNames } },
        orderBy: { createdAt: "desc" },
        select: { name: true, plainText: true, createdAt: true },
      })
    : [];
  // Keep only the latest snapshot per doc name.
  const latestCollabByName = new Map<string, { plainText: string; createdAt: Date }>();
  for (const row of collabVersionRows) {
    if (!latestCollabByName.has(row.name)) {
      latestCollabByName.set(row.name, {
        plainText: row.plainText,
        createdAt: row.createdAt,
      });
    }
  }

  const interviews = interviewRows.map((iv) => {
    const jointNotes = latestCollabByName.get(`interview:${iv.id}:notes`) ?? null;
    return {
      id: iv.id,
      startTime: iv.startTime.toISOString(),
      endTime: iv.endTime.toISOString(),
      status: iv.status,
      location: iv.location,
      zoomJoinUrl: iv.zoomJoinUrl,
      recommendation: iv.recommendation,
      recommendationNotes: iv.recommendationNotes,
      jointNotes: jointNotes
        ? {
            plainText: jointNotes.plainText,
            updatedAt: jointNotes.createdAt.toISOString(),
          }
        : null,
      assignments: iv.assignments.map((a) => {
        const isViewerThisInterviewer = a.cycleInterviewer.userId === auth.user.sub;
        const privateNotes = canSeePreReleaseDecisions
          ? latestCollabByName.get(`interview:${iv.id}:rec-notes-${a.id}`) ?? null
          : null;
        return {
          id: a.id,
          role: a.role,
          interviewerName:
            [a.cycleInterviewer.user.firstName, a.cycleInterviewer.user.lastName]
              .filter(Boolean)
              .join(" ")
              .trim() || "Interviewer",
          domainName: a.cycleInterviewer.domain.name,
          canEditNotes: isViewerThisInterviewer,
          privateNotes: privateNotes
            ? {
                plainText: privateNotes.plainText,
                updatedAt: privateNotes.createdAt.toISOString(),
              }
            : null,
        };
      }),
    };
  });

  // Decisions: applicants never reach this page; reviewers (in-domain) see only
  // Released. Core/DomainLead see the full append-only history.
  const visibleDecisions = decisionRows
    .filter((d) => canSeePreReleaseDecisions || d.stage === "Released")
    .map((d) => ({
      id: d.id,
      type: d.type,
      stage: d.stage,
      notes: d.notes,
      waitlistRank: d.waitlistRank,
      createdAt: d.createdAt.toISOString(),
      madeByName:
        [d.madeBy?.firstName, d.madeBy?.lastName].filter(Boolean).join(" ").trim() || null,
    }));

  // For each delibs session, find which column this DA sits in (if any). Some
  // closed sessions may not contain the DA at all — exclude those.
  type DelibsRef = {
    id: string;
    type: "Initial" | "Final";
    status: "Active" | "Closed";
    column: string | null;
    updatedAt: string;
  };
  const delibs: DelibsRef[] = canSeeDelibs
    ? delibsSessions
        .map((s): DelibsRef | null => {
          const cols = (s.columnOrder ?? {}) as Record<string, unknown>;
          let column: string | null = null;
          for (const [name, ids] of Object.entries(cols)) {
            if (Array.isArray(ids) && ids.includes(da.id)) {
              column = name;
              break;
            }
          }
          // Only surface sessions that actually reference this DA. An active
          // session for the domain doesn't necessarily contain every DA.
          if (column === null) return null;
          return {
            id: s.id,
            type: s.type,
            status: s.status,
            column,
            updatedAt: s.updatedAt.toISOString(),
          };
        })
        .filter((s): s is DelibsRef => s !== null)
    : [];

  // Selected review = ?review= if valid, else the first.
  const url = new URL(request.url);
  const requested = url.searchParams.get("review");
  const selectedReviewId =
    (requested && reviews.find((r) => r.id === requested)?.id) ??
    reviews[0]?.id ??
    null;

  // Shape the application object the way ApplicationViewer expects: a single
  // domainApplication (this one), plus general answers.
  const domainName =
    da.domain?.displayName ?? da.challengeVersion?.domain?.displayName ?? "Domain";
  const application = {
    answers: generalAnswers,
    generalChallengeVersion: da.application.generalChallengeVersion
      ? {
          questions: da.application.generalChallengeVersion.questions,
          description: da.application.generalChallengeVersion.description,
        }
      : null,
    domainApplications: [
      {
        id: da.id,
        answers: domainAnswers,
        challengeVersion: {
          questions: da.challengeVersion?.questions ?? [],
          description: da.challengeVersion?.description,
          domain: { name: da.challengeVersion?.domain?.name ?? domainName },
          challenge: { name: da.challengeVersion?.challenge?.name ?? "Challenge" },
        },
      },
    ],
  };

  // "Demonstrated interest": the applicant's education engagement, keyed on
  // the shared User row. Includes internal instructor notes — this page
  // already sits behind reviewer access + confidentiality signing.
  const educationEngagement = await getEducationEngagement(da.application.user.id);

  return {
    applicantName:
      [da.application.user.firstName, da.application.user.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || "Applicant",
    educationEngagement,
    cycleName: da.application.applicationCycle.name,
    domainName,
    application,
    questionLabels,
    criterionLabels,
    reviews,
    interviews,
    decisions: visibleDecisions,
    delibs,
    interviewPrepNote: canSeeDelibs ? da.interviewPrepNote : null,
    canSeePreReleaseDecisions,
    canSeeDelibs,
    selectedReviewId,
  };
}

export default function ApplicationReadOnlyDetail() {
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const selected =
    data.reviews.find((r) => r.id === data.selectedReviewId) ?? null;

  return (
    <div className="space-y-6 pb-12">
      <ApplicantDetailHeader
        name={data.applicantName}
        domainName={data.domainName}
        cycleName={data.cycleName}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: application content (read-only annotations from the selected
            review render inline). */}
        <div className="lg:col-span-2">
          <ApplicationViewer
            application={data.application}
            questionLabels={data.questionLabels}
            initialAnnotations={selected?.annotations ?? []}
            readOnly
          />
        </div>

        {/* Right: review viewer. */}
        <div className="space-y-4">
          <DetailCard
            title="Reviews"
            subtitle={
              data.reviews.length === 0
                ? "No submitted reviews yet."
                : `${data.reviews.length} submitted`
            }
            className="sticky top-24"
          >
            {data.reviews.length > 0 && (
              <div className="p-6 space-y-5">
                {/* Reviewer selector */}
                <div>
                  <label
                    htmlFor="review-select"
                    className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1"
                  >
                    Reviewer
                  </label>
                  <select
                    id="review-select"
                    value={data.selectedReviewId ?? ""}
                    onChange={(e) => {
                      const next = new URLSearchParams(searchParams);
                      next.set("review", e.target.value);
                      setSearchParams(next);
                    }}
                    className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                  >
                    {data.reviews.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.reviewerName}
                      </option>
                    ))}
                  </select>
                </div>

                {selected && (
                  <ReviewSummary
                    reviewerName={selected.reviewerName}
                    reviewerPhotoUrl={selected.reviewerPhotoUrl}
                    overallRecommendation={selected.overallRecommendation}
                    scores={selected.scores}
                    criteria={Object.fromEntries(
                      Object.entries(data.criterionLabels).map(([key, label]) => [
                        key,
                        { label },
                      ]),
                    )}
                    feedback={selected.feedback}
                    rejectionRationale={selected.rejectionRationale}
                    footerNote={
                      selected.submittedAt ? (
                        <>
                          Submitted{" "}
                          {new Date(selected.submittedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                          . Highlighted passages from this review appear inline on the left.
                        </>
                      ) : null
                    }
                  />
                )}
              </div>
            )}
          </DetailCard>
        </div>
      </div>

      <EducationEngagementPanel entries={data.educationEngagement} />

      <InterviewsSection
        interviews={data.interviews}
        interviewPrepNote={data.interviewPrepNote}
      />
      <DecisionsSection
        decisions={data.decisions}
        canSeePreReleaseDecisions={data.canSeePreReleaseDecisions}
      />
      {data.canSeeDelibs && <DelibsSection delibs={data.delibs} />}
    </div>
  );
}

type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;
type InterviewRow = LoaderData["interviews"][number];
type DecisionRow = LoaderData["decisions"][number];
type DelibsRef = LoaderData["delibs"][number];

function InterviewsSection({
  interviews,
  interviewPrepNote,
}: {
  interviews: InterviewRow[];
  interviewPrepNote: string | null;
}) {
  const hasPrepNote = interviewPrepNote != null && interviewPrepNote.trim().length > 0;
  return (
    <DetailCard
      title="Interviews"
      subtitle={
        interviews.length === 0
          ? "No interviews yet."
          : `${interviews.length} ${interviews.length === 1 ? "interview" : "interviews"}`
      }
    >
      {hasPrepNote && (
        <div className="px-6 py-3 border-b border-border bg-amber-50/40">
          <div className="text-xs font-bold text-amber-900 uppercase tracking-wider">
            Interview prep note
          </div>
          <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">
            {interviewPrepNote}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            Set by leads during Initial delibs.
          </p>
        </div>
      )}
      {interviews.length > 0 && (
        <ul className="divide-y divide-border">
          {interviews.map((iv) => (
            <li key={iv.id}>
              <InterviewNotesCard interview={toInterviewNotesData(iv)} />
            </li>
          ))}
        </ul>
      )}
    </DetailCard>
  );
}

// Map the rich loader row into the shared InterviewNotesCard prop shape.
function toInterviewNotesData(iv: InterviewRow): InterviewNotesData {
  return {
    id: iv.id,
    startTime: iv.startTime,
    endTime: iv.endTime,
    status: iv.status,
    location: iv.location,
    zoomJoinUrl: iv.zoomJoinUrl,
    recommendation: iv.recommendation,
    recommendationNotes: iv.recommendationNotes,
    jointNotes: iv.jointNotes,
    openInInterviewerHref: iv.assignments.some((a) => a.canEditNotes)
      ? `/hiring/interviews/${iv.id}`
      : undefined,
    interviewers: iv.assignments.map((a) => ({
      id: a.id,
      name: a.interviewerName,
      role: a.role,
      domainName: a.domainName,
      notes: a.privateNotes?.plainText ?? null,
      notesUpdatedAt: a.privateNotes?.updatedAt ?? null,
    })),
  };
}


function DecisionsSection({
  decisions,
  canSeePreReleaseDecisions,
}: {
  decisions: DecisionRow[];
  canSeePreReleaseDecisions: boolean;
}) {
  return (
    <DetailCard
      title="Decisions"
      subtitle={
        <>
          {decisions.length === 0
            ? canSeePreReleaseDecisions
              ? "No decisions recorded."
              : "No released decisions yet."
            : `${decisions.length} ${decisions.length === 1 ? "record" : "records"}`}
          {!canSeePreReleaseDecisions && decisions.length > 0 && " (released only)"}
        </>
      }
    >
      {decisions.length > 0 && <DecisionHistoryList decisions={decisions} showNotes />}
    </DetailCard>
  );
}

function DelibsSection({ delibs }: { delibs: DelibsRef[] }) {
  return (
    <DetailCard
      title="Delibs"
      subtitle={
        delibs.length === 0
          ? "Not part of any delibs session."
          : `${delibs.length} ${delibs.length === 1 ? "session" : "sessions"}`
      }
    >
      {delibs.length > 0 && (
        <ul className="divide-y divide-border">
          {delibs.map((s) => (
            <li key={s.id} className="px-6 py-3 flex items-center gap-3">
              <span className="text-sm font-medium text-foreground">{s.type} delibs</span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                  s.status === "Active"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-muted text-foreground/80"
                }`}
              >
                {s.status}
              </span>
              {s.column && (
                <span className="text-xs text-muted-foreground">in “{s.column}”</span>
              )}
              <span className="ml-auto text-xs text-muted-foreground/70">
                Updated{" "}
                {new Date(s.updatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DetailCard>
  );
}
