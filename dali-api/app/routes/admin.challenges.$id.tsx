import { redirect } from "react-router";
import type { Route } from "./+types/admin.challenges.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
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

  // Load all domain rubrics (for rubric attachment dropdown across all versions)
  const rubrics = await prisma.rubric.findMany({
    where: { domainId: { not: null } },
    include: {
      domain: true,
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
    },
    orderBy: { name: "asc" },
  });

  return { challenge, domains, rubrics };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const user = await prisma.user.findUnique({ where: { id: auth.user.sub } });
  if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 401 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create-version") {
    const domainId = formData.get("domainId") as string;
    const questionsJson = formData.get("questions") as string;

    if (!domainId) return { error: "Domain is required" };

    const questions = JSON.parse(questionsJson || "[]");

    await prisma.challengeVersion.create({
      data: {
        challengeId: params.id,
        domainId,
        questions,
        createdById: user.id,
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
