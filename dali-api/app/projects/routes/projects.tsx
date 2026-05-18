import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects";
import { requireAuth } from "~/lib/auth";
import { currentTerm } from "~/lib/roles";
import { canCreateProject } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { listProjectsForUser } from "~/projects/lib/queries";
import { ProjectDirectory } from "~/projects/components/ProjectDirectory";

export const meta: Route.MetaFunction = () => [{ title: "Projects · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  const url = new URL(request.url);
  const showArchived = url.searchParams.get("archived") === "1";

  const [term, canCreate] = await Promise.all([
    currentTerm(),
    canCreateProject(auth.user.sub),
  ]);

  const [directory, partnerOrgs, pmEligibleMembers, terms] = await Promise.all([
    listProjectsForUser(auth.user.sub, term?.id ?? null, showArchived),
    canCreate
      ? prisma.partnerOrg.findMany({
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    canCreate
      ? prisma.domainEligibility.findMany({
          where: { domain: { code: "PM" } },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        })
      : Promise.resolve(
          [] as { user: { id: string; firstName: string; lastName: string } }[],
        ),
    canCreate
      ? prisma.term.findMany({
          orderBy: { sortKey: "asc" },
          select: { id: true, code: true },
        })
      : Promise.resolve([] as { id: string; code: string }[]),
  ]);

  return {
    directory,
    canCreate,
    showArchived,
    currentTermCode: term?.code ?? null,
    currentTermId: term?.id ?? null,
    partnerOrgs,
    pmEligibleMembers: pmEligibleMembers.map((e) => ({
      id: e.user.id,
      firstName: e.user.firstName,
      lastName: e.user.lastName,
    })),
    terms,
  };
}

export default function ProjectsDirectoryRoute() {
  const data = useLoaderData<typeof loader>();
  return <ProjectDirectory {...data} />;
}
