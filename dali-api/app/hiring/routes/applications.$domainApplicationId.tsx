import { Link, redirect, useLoaderData, useSearchParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/applications.$domainApplicationId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { requirePageSignedOrRedirect } from "~/hiring/lib/confidentiality";
import { presignAnswers } from "~/hiring/lib/presign";
import { ApplicationViewer } from "~/hiring/components/ApplicationViewer";
import { ReviewSummary } from "~/hiring/components/ReviewSummary";
import type { Question, RubricCriterion } from "~/types";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as { applicantName?: string } | undefined)?.applicantName;
  return [{ title: `${name ?? "Application"} · Applications · DALI OS` }];
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
  if (auth.user.type === "applicant") return redirect("/portal");

  const da = await prisma.domainApplication.findUnique({
    where: { id: params.domainApplicationId },
    select: {
      id: true,
      domainId: true,
      answers: true,
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
          user: { select: { firstName: true, lastName: true } },
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

  // Submitted reviews for THIS domain application, with reviewer identity.
  const reviewRows = await prisma.applicationReview.findMany({
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
      submittedBy: { select: { firstName: true, lastName: true } },
    },
  });
  const reviews = reviewRows.map((r) => ({
    id: r.id,
    reviewerName:
      [r.submittedBy?.firstName, r.submittedBy?.lastName].filter(Boolean).join(" ").trim() ||
      "Reviewer",
    scores: r.scores as Record<string, number>,
    feedback: r.feedback,
    rejectionRationale: r.rejectionRationale,
    overallRecommendation: r.overallRecommendation,
    annotations: (r.annotations as object[]) ?? [],
    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
  }));

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

  return {
    applicantName:
      [da.application.user.firstName, da.application.user.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || "Applicant",
    cycleName: da.application.applicationCycle.name,
    domainName,
    application,
    questionLabels,
    criterionLabels,
    reviews,
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
      <div>
        <Link
          to="/hiring/applications"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground/80"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Applications
        </Link>
        <h1 className="text-2xl font-bold text-foreground mt-2">
          {data.applicantName}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {data.domainName} · {data.cycleName}
        </p>
      </div>

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
          <div className="bg-card rounded-xl border border-border shadow-sm sticky top-24">
            <div className="px-6 py-4 border-b border-border bg-muted/50">
              <h2 className="text-lg font-bold text-foreground">Reviews</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.reviews.length === 0
                  ? "No submitted reviews yet."
                  : `${data.reviews.length} submitted`}
              </p>
            </div>

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
          </div>
        </div>
      </div>
    </div>
  );
}
