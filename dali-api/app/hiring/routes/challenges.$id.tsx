import { redirect } from "react-router";
import type { Route } from "./+types/challenges.$id";
import { prisma } from "~/lib/db";
import { requireCoreOrDomainLead } from "~/lib/auth";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { ChallengeDetail } from "~/hiring/components/ChallengeDetail";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as any)?.challenge?.name;
  return [{ title: `${name || "Challenge"} · DALI OS` }];
};

export const handle = {
  // The Library owns challenges (list at /hiring/library?tab=challenges); the
  // bare /hiring/challenges prefix has no page, so declare the trail back to it.
  breadcrumbTrail: (data: unknown) => {
    const name = (data as { challenge?: { name: string } } | undefined)
      ?.challenge?.name;
    if (!name) return null;
    return [
      { label: "Hiring", to: "/hiring" },
      { label: "Challenges", to: "/hiring/library?tab=challenges" },
      { label: name },
    ];
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const gate = await requireCoreOrDomainLead(request);
  if (!gate.ok) return gate.response;
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

  // ChallengeVersion rows are immutable — legacy ProseMirror descriptions
  // convert to block JSON on read, forever. New versions store blocks.
  return {
    challenge: {
      ...challenge,
      versions: challenge.versions.map((v) => ({
        ...v,
        description: ensureBlocks(v.description),
      })),
    },
    domains,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const gate = await requireCoreOrDomainLead(request);
  if (!gate.ok) return gate.response;
  const auth = gate.auth;

  const user = await prisma.user.findUnique({ where: { id: auth.user.sub } });
  if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 401 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create-version") {
    const domainId = (formData.get("domainId") as string) || null;
    const questionsJson = formData.get("questions") as string;
    const descriptionJson = (formData.get("description") as string) ?? "";

    const questions = JSON.parse(questionsJson || "[]");
    const description = descriptionJson ? JSON.parse(descriptionJson) : null;

    await prisma.challengeVersion.create({
      data: {
        challengeId: params.id,
        domainId,
        questions,
        ...(description ? { description } : {}),
        createdById: user.id,
      },
    });

    return redirect(`/hiring/challenges/${params.id}`);
  }

  return null;
}

export default ChallengeDetail;
