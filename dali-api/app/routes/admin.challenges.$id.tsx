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
          include: { domain: true, createdBy: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.domain.findMany({ orderBy: { name: "asc" } }),
  ]);
  return { challenge, domains };
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

  return null;
}

export default ChallengeDetail;
