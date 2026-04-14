import { redirect } from "react-router";
import type { Route } from "./+types/admin.challenges";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import Challenges from "~/components/Challenges";

export async function loader({}: Route.LoaderArgs) {
  // Ensure a General domain always exists (idempotent)
  await prisma.domain.upsert({
    where: { id: "domain-general" },
    update: {},
    create: { id: "domain-general", name: "General" },
  });

  const [domains, challenges, generalForm, generalRubrics] = await Promise.all([
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
    // Fetch the most recent application form version (general form)
    prisma.applicationFormVersion.findFirst({
      orderBy: { createdAt: "desc" },
      include: {
        rubricVersions: { include: { rubric: true }, take: 1 },
      },
    }),
    // General rubrics (no domain, or explicitly the General domain)
    prisma.rubric.findMany({
      where: { OR: [{ domainId: null }, { domain: { name: "General" } }] },
      include: {
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { domains, challenges, generalForm, generalRubrics };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "attach-form-rubric") {
    const auth = await requireAuth(request);
    if (!auth.ok) return redirect("/login");
    const formVersionId = formData.get("formVersionId") as string;
    const rubricVersionId = (formData.get("rubricVersionId") as string) || null;
    if (rubricVersionId) {
      await prisma.rubricVersion.update({
        where: { id: rubricVersionId },
        data: { applicationFormVersionId: formVersionId },
      });
    } else {
      await prisma.rubricVersion.updateMany({
        where: { applicationFormVersionId: formVersionId },
        data: { applicationFormVersionId: null },
      });
    }
    return null;
  }

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
