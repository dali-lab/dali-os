import { redirect } from "react-router";
import type { Route } from "./+types/admin.challenges.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead } from "~/lib/roles";
import { ChallengeDetail } from "~/components/ChallengeDetail";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isHiringLead(auth.user.sub)) && !(await isDomainLead(auth.user.sub))) return redirect("/");
  const [challenge, domains] = await Promise.all([
    prisma.challenge.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        versions: {
          include: {
            domain: true,
            createdBy: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.domain.findMany({ orderBy: { name: "asc" } }),
  ]);

  return { challenge, domains };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isHiringLead(auth.user.sub)) && !(await isDomainLead(auth.user.sub))) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });

  const user = await prisma.user.findUnique({ where: { id: auth.user.sub } });
  if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 401 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create-version") {
    const domainId = (formData.get("domainId") as string) || null;
    const questionsJson = formData.get("questions") as string;

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

  return null;
}

export default ChallengeDetail;
