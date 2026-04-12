import { redirect } from "react-router";
import type { Route } from "./+types/admin.challenges";
import { prisma } from "~/lib/db";
import Challenges from "~/components/Challenges";

export async function loader({}: Route.LoaderArgs) {
  // Ensure a General domain always exists (idempotent)
  await prisma.domain.upsert({
    where: { id: "domain-general" },
    update: {},
    create: { id: "domain-general", name: "General" },
  });

  const [domains, challenges] = await Promise.all([
    prisma.domain.findMany({ orderBy: { name: "asc" } }),
    prisma.challenge.findMany({
      include: {
        versions: {
          include: { domain: true, createdBy: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { domains, challenges };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const name = (formData.get("name") as string)?.trim();
    const domainId = formData.get("domainId") as string | null;
    if (!name) return { error: "Name is required" };

    const challenge = await prisma.challenge.create({ data: { name } });
    const dest = domainId
      ? `/challenges/${challenge.id}?domainId=${domainId}`
      : `/challenges/${challenge.id}`;
    return redirect(dest);
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    // Delete all versions first (cascade not set in schema)
    await prisma.challengeVersion.deleteMany({ where: { challengeId: id } });
    await prisma.challenge.delete({ where: { id } });
    return null;
  }

  return null;
}

export default Challenges;
