import { redirect } from "react-router";
import type { Route } from "./+types/admin.challenges.$id";
import { prisma } from "~/lib/db";
import { ChallengeDetail } from "~/components/ChallengeDetail";

export async function loader({ params }: Route.LoaderArgs) {
  const [challenge, domains] = await Promise.all([
    prisma.challenge.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        versions: {
          include: {
            domain: true,
            createdBy: true,
            rubricVersion: { include: { rubric: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.domain.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Load rubrics that match any domain used in this challenge's versions.
  const domainIds = [...new Set(challenge.versions.map((v) => v.domainId))];
  const rubrics = await prisma.rubric.findMany({
    where: { domainId: { in: domainIds } },
    include: {
      domain: true,
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
    },
    orderBy: { name: "asc" },
  });

  return { challenge, domains, rubrics };
}

export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create-version") {
    const domainId = formData.get("domainId") as string;
    const questionsJson = formData.get("questions") as string;

    if (!domainId) return { error: "Domain is required" };

    const questions = JSON.parse(questionsJson || "[]");

    // TODO: replace with session user once login flow is built
    const adminUser = await prisma.user.findFirstOrThrow({
      where: { daliEmail: "admin@dali.dartmouth.edu" },
    });

    await prisma.challengeVersion.create({
      data: {
        challengeId: params.id,
        domainId,
        questions,
        createdById: adminUser.id,
      },
    });

    return redirect(`/challenges/${params.id}`);
  }

  if (intent === "attach-rubric") {
    const challengeVersionId = formData.get("challengeVersionId") as string;
    const rubricVersionId = (formData.get("rubricVersionId") as string) || null;
    await prisma.challengeVersion.update({
      where: { id: challengeVersionId },
      data: { rubricVersionId: rubricVersionId || null },
    });
    return null;
  }

  return null;
}

export default ChallengeDetail;
