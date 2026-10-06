import { Link, useLoaderData } from "react-router";
import { ArrowLeft } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { hasCycleAccess } from "~/lib/roles";
import { requirePageSignedOrRedirect } from "~/hiring/lib/confidentiality";
import { presignAnswers } from "~/hiring/lib/presign";
import { applicationBlindLabel, reviewerBlindLabel, blindUser } from "~/hiring/lib/anonymization.server";
import { overallApplicationStatus } from "~/hiring/lib/applicant-history.server";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { safeParseJsonString } from "~/forms/lib/forms-data";
import { ApplicationViewer } from "~/hiring/components/ApplicationViewer";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import type { Route } from "./+types/reviewer.application.$id.prior.$priorId";
import type { Question } from "~/types";

// A reviewer's read-only look at the same applicant's earlier, already-decided
// application — surfaced from the "Prior applications" panel on
// reviewer.application.$id. Reviews, scores, decisions and interviews from
// that prior cycle are never loaded here, let alone rendered: this is the
// applicant's submission only. Blind review still applies, keyed to the
// *current* application the reviewer is assigned to review.

export const meta: Route.MetaFunction = ({ data }) => {
  const user = (data as { application?: { user?: { firstName?: string; lastName?: string } } } | undefined)
    ?.application?.user;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return [{ title: `${name || "Applicant"} · Prior application · DALI OS` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const current = await prisma.application.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      userId: true,
      applicationCycleId: true,
      applicationCycle: { select: { anonymizeReview: true } },
    },
  });
  if (!current) throw new Response("Not found", { status: 404 });

  if (!(await hasCycleAccess(auth.user.sub, current.applicationCycleId)))
    throw redirectToLogin(request);

  const confRedirect = await requirePageSignedOrRedirect(
    auth.user.sub,
    current.applicationCycleId,
    request,
  );
  if (confRedirect) return confRedirect;

  const prior = await prisma.application.findUnique({
    where: { id: params.priorId },
    include: {
      user: true,
      applicationFormVersion: true,
      applicationCycle: { select: { name: true } },
      statusUpdates: true,
      domainApplications: {
        where: { selected: true },
        include: {
          challengeFormVersion: {
            select: { questions: true, intro: true, form: { select: { name: true } } },
          },
          domain: true,
        },
      },
    },
  });

  if (
    !prior ||
    prior.userId !== current.userId ||
    prior.id === current.id ||
    overallApplicationStatus(prior.statusUpdates) === "Draft"
  ) {
    throw new Response("Not found", { status: 404 });
  }

  // Blinded here if the viewer is blinded to the CURRENT applicant on either
  // surface that links here (the reviewer page or the lead detail pages). The
  // prior cycle's own released decisions don't lift it.
  const [reviewerLabel, applicationLabel] = await Promise.all([
    reviewerBlindLabel({
      reviewerId: auth.user.sub,
      cycleId: current.applicationCycleId,
      applicationId: current.id,
      anonymizeReview: current.applicationCycle.anonymizeReview,
    }),
    applicationBlindLabel({
      cycleId: current.applicationCycleId,
      applicationId: current.id,
      anonymizeReview: current.applicationCycle.anonymizeReview,
    }),
  ]);
  const blindLabel = reviewerLabel ?? applicationLabel;
  if (blindLabel) prior.user = blindUser(prior.user, blindLabel);

  // Presign file-type answers and synthesize the viewer's challenge-version
  // shape, exactly as reviewer.application.$id's loader does.
  const generalQuestionsForPresign =
    (prior.applicationFormVersion?.questions as unknown as Question[]) ?? [];
  const presignedGeneralAnswers = await presignAnswers(
    generalQuestionsForPresign,
    prior.answers as Record<string, string>,
  );
  const presignedDomainApplications = await Promise.all(
    prior.domainApplications.map(async (da: any) => {
      const challengeVersion = da.challengeFormVersion
        ? {
            questions: da.challengeFormVersion.questions,
            description: ensureBlocks(safeParseJsonString(da.challengeFormVersion.intro)),
            domain: da.domain ?? { name: "Domain" },
            challenge: { name: da.challengeFormVersion.form?.name ?? "Challenge" },
          }
        : null;
      const questions = (da.challengeFormVersion?.questions ?? []) as Question[];
      return {
        ...da,
        challengeVersion,
        answers: await presignAnswers(questions, da.answers as Record<string, string>),
      };
    }),
  );

  const application = {
    ...prior,
    answers: presignedGeneralAnswers,
    generalChallengeVersion: prior.applicationFormVersion
      ? {
          id: prior.applicationFormVersion.id,
          questions: prior.applicationFormVersion.questions,
          description: ensureBlocks(safeParseJsonString(prior.applicationFormVersion.intro)),
        }
      : null,
    domainApplications: presignedDomainApplications,
  };

  const questionLabels: Record<string, string> = {};
  for (const q of generalQuestionsForPresign) {
    questionLabels[q.key] = q.data.label;
  }
  for (const da of presignedDomainApplications) {
    const qs = (da.challengeVersion?.questions as unknown as Question[] | undefined) ?? [];
    for (const q of qs) {
      questionLabels[q.key] = q.data.label;
    }
  }

  const submitted = prior.statusUpdates
    .filter((u) => u.newStatus === "Submitted")
    .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())[0];

  return {
    application,
    questionLabels,
    currentApplicationId: current.id,
    priorCycleName: prior.applicationCycle.name,
    submittedAt: submitted?.createdAt ?? null,
    applicationType: prior.applicationType,
    blinded: blindLabel != null,
  };
}

export default function ReviewerPriorApplicationView() {
  const { application, questionLabels, currentApplicationId, priorCycleName, submittedAt, applicationType } =
    useLoaderData<typeof loader>();
  const { pageTitle, bodyText, heading } = useOsChrome();
  const tz = useUserTimeZone();

  const name = `${application.user.firstName} ${application.user.lastName}`.trim();

  return (
    <div className="flex flex-col gap-6 pb-12">
      <div className="flex flex-col gap-2">
        <Link
          to={`/hiring/reviewer/application/${currentApplicationId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to current application
        </Link>
        <div className="flex flex-col gap-1">
          <p className={heading}>Prior application · read-only</p>
          <h1 className={pageTitle}>{name}</h1>
          <p className={bodyText}>
            {priorCycleName}
            {submittedAt ? ` · Submitted ${formatDateShort(submittedAt, tz)}` : ""} · {applicationType}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        This is a previous application from {priorCycleName}. Reviews, scores and decisions from
        that cycle aren&apos;t shown.
      </div>

      <ApplicationViewer application={application} questionLabels={questionLabels} readOnly />
    </div>
  );
}
