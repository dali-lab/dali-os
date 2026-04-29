import type { Route } from "./+types/api.domain-applications.$id.full-context";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const da = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    include: {
      challengeVersion: {
        select: {
          questions: true,
          domain: { select: { id: true, name: true } },
        },
      },
      application: {
        include: {
          user: { select: { firstName: true, lastName: true } },
          generalChallengeVersion: { select: { questions: true } },
          applicationCycle: { select: { id: true, generalRubricVersionId: true } },
        },
      },
      reviews: {
        orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
        include: {
          cycleReviewer: {
            include: {
              daliMember: { select: { firstName: true, lastName: true } },
            },
          },
        },
      },
      decisions: {
        orderBy: { createdAt: "desc" },
        include: { madeBy: { select: { firstName: true, lastName: true } } },
      },
    },
  });

  if (!da) return Response.json({ error: "Not found" }, { status: 404 });
  if (!(await hasCycleAccess(auth.user.sub, da.application.applicationCycleId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const domainId = da.challengeVersion.domain?.id ?? null;
  const [domainCycle, generalRubric] = await Promise.all([
    domainId
      ? prisma.domainApplicationCycle.findUnique({
          where: {
            domainId_applicationCycleId: {
              domainId,
              applicationCycleId: da.application.applicationCycleId,
            },
          },
          select: { rubricVersion: { select: { criteria: true } } },
        })
      : Promise.resolve(null),
    da.application.applicationCycle.generalRubricVersionId
      ? prisma.rubricVersion.findUnique({
          where: { id: da.application.applicationCycle.generalRubricVersionId },
          select: { criteria: true },
        })
      : Promise.resolve(null),
  ]);

  return Response.json({
    domainApplication: {
      id: da.id,
      answers: da.answers,
      domain: da.challengeVersion.domain,
      challengeQuestions: da.challengeVersion.questions,
    },
    application: {
      id: da.application.id,
      answers: da.application.answers,
      generalQuestions: da.application.generalChallengeVersion?.questions ?? [],
      applicant: da.application.user,
    },
    reviews: da.reviews,
    decisions: da.decisions,
    rubric: {
      generalCriteria: generalRubric?.criteria ?? [],
      domainCriteria: domainCycle?.rubricVersion?.criteria ?? [],
    },
  });
}
