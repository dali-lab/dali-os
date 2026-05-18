import { redirect, useOutletContext } from "react-router";
import type { Route } from "./+types/projects.$projectId.settings";
import { requireAuth } from "~/lib/auth";
import { getProjectMembership } from "~/lib/projectAuth";
import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { SettingsTab } from "~/projects/components/SettingsTab";
import type { WorkspaceData } from "~/projects/lib/queries";
import type { ProjectMembership } from "~/lib/projectAuth";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const projectId = params.projectId!;
  const membership = await getProjectMembership(auth.user.sub, projectId);
  if (!membership.canEditSettings && !membership.canArchive) {
    throw new Response("Forbidden", { status: 403 });
  }

  const term = await currentTerm();

  const [roleRequests, termStatus, partners, partnerOrgs, terms, domains] = await Promise.all([
    prisma.projectRoleRequest.findMany({
      where: { projectId, termId: term?.id ?? "" },
      include: { domain: { select: { id: true, code: true, displayName: true } } },
    }),
    term
      ? prisma.projectTermStatus.findUnique({
          where: { projectId_termId: { projectId, termId: term.id } },
        })
      : Promise.resolve(null),
    prisma.projectPartner.findMany({
      where: { projectId },
      include: {
        partnerOrg: { select: { id: true, name: true } },
      },
    }),
    prisma.partnerOrg.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.term.findMany({
      orderBy: { sortKey: "asc" },
      select: { id: true, code: true },
    }),
    prisma.domain.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { id: true, code: true, displayName: true },
    }),
  ]);

  return {
    roleRequests,
    termStatus,
    partners,
    partnerOrgs,
    terms,
    domains,
    currentTermId: term?.id ?? null,
    currentTermCode: term?.code ?? null,
  };
}

type CtxData = { workspace: WorkspaceData; membership: ProjectMembership };

export default function SettingsRoute({ loaderData }: Route.ComponentProps) {
  const ctx = useOutletContext<CtxData>();
  return (
    <SettingsTab
      data={loaderData}
      workspace={ctx.workspace}
      membership={ctx.membership}
    />
  );
}
