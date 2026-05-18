import { redirect, useOutletContext } from "react-router";
import type { Route } from "./+types/projects.$projectId.people";
import { requireAuth } from "~/lib/auth";
import { currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { getProjectRoster, getProjectAssignmentHistory } from "~/projects/lib/queries";
import { PeopleTab } from "~/projects/components/PeopleTab";
import type { WorkspaceData } from "~/projects/lib/queries";
import type { ProjectMembership } from "~/lib/projectAuth";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const projectId = params.projectId!;
  const url = new URL(request.url);
  const requestedTermId = url.searchParams.get("term");

  const term = requestedTermId
    ? await prisma.term.findUnique({
        where: { id: requestedTermId },
        select: { id: true, code: true },
      })
    : await currentTerm();

  const [roster, history, partners] = await Promise.all([
    term
      ? getProjectRoster(projectId, term.id)
      : Promise.resolve([]),
    getProjectAssignmentHistory(projectId),
    prisma.projectPartner.findMany({
      where: { projectId, endedAt: null },
      include: {
        partnerOrg: {
          include: {
            users: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    dartmouthEmail: true,
                    daliEmail: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    roster,
    history: history.map((h) => ({ termId: h.termId, termCode: h.termCode })),
    selectedTermCode: term?.code ?? null,
    selectedTermId: term?.id ?? null,
    partners,
  };
}

type CtxData = { workspace: WorkspaceData; membership: ProjectMembership };

export default function PeopleRoute({ loaderData }: Route.ComponentProps) {
  const ctx = useOutletContext<CtxData>();
  return <PeopleTab data={loaderData} workspace={ctx.workspace} />;
}
