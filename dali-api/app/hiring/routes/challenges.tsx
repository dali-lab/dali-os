import { redirect } from "react-router";
import type { Route } from "./+types/challenges";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead, isAdmin } from "~/lib/roles";
import Challenges from "~/hiring/components/Challenges";

export const meta: Route.MetaFunction = () => [{ title: "Challenges · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  if (!(await isHiringLead(auth.user.sub)) && !(await isDomainLead(auth.user.sub)) && !(await isAdmin(auth.user.sub))) return withAuth(auth, redirect("/"));
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
  return withAuth(auth, { domains, challenges });
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  if (!(await isHiringLead(auth.user.sub)) && !(await isDomainLead(auth.user.sub)) && !(await isAdmin(auth.user.sub))) return withAuth(auth, redirect("/"));

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create") {
    const name = (formData.get("name") as string)?.trim();
    const domainId = formData.get("domainId") as string | null;
    const isGeneral = formData.get("general") === "1";
    if (!name) return withAuth(auth, { error: "Name is required" });

    const challenge = await prisma.challenge.create({ data: { name } });
    const dest = isGeneral
      ? `/hiring/challenges/${challenge.id}?general=1`
      : domainId
        ? `/hiring/challenges/${challenge.id}?domainId=${domainId}`
        : `/hiring/challenges/${challenge.id}`;
    return withAuth(auth, redirect(dest));
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    // Delete all versions first (cascade not set in schema)
    await prisma.challengeVersion.deleteMany({ where: { challengeId: id } });
    await prisma.challenge.delete({ where: { id } });
    return withAuth(auth, null);
  }

  return withAuth(auth, null);
}

export default Challenges;
