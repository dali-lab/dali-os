import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/partner.projects.$id.pages.$pageId";
import { prisma } from "~/lib/db";
import { parseSessionCookie } from "~/lib/cookies";
import { getPresenceUser } from "~/lib/presence-user";
import { requirePartner } from "~/partners/lib/partner-auth.server";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { PartnerDocumentView } from "~/partners/components/PartnerDocumentView";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { page?: { title: string } } | undefined)?.page?.title;
  return [{ title: t ? `${t} · DALI OS` : "Document · DALI OS" }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth } = await requirePartner(request);
  if (!(await partnerHasProjectAccess(auth.user.sub, params.id!))) {
    throw new Response("Not found", { status: 404 });
  }

  // Only explicitly shared, live pages belonging to THIS project — a shared
  // page id from another project must 404 here. Mirrors authorizeCollabDoc,
  // which independently gates the websocket.
  const page = await prisma.page.findFirst({
    where: {
      id: params.pageId,
      workspaceType: "Project",
      workspaceId: params.id,
      archivedAt: null,
      partnerVisible: true,
    },
    select: { id: true, title: true },
  });
  if (!page) throw new Response("Not found", { status: 404 });

  const fallbackName =
    [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
    auth.user.email;
  const presenceUser = await getPresenceUser(auth.user.sub, fallbackName);

  return {
    page,
    projectId: params.id!,
    collabToken: parseSessionCookie(request),
    userName: presenceUser?.name ?? fallbackName,
  };
}

export default function PartnerProjectPage() {
  const { page, projectId, collabToken, userName } =
    useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-4">
      <Link
        to={`/partner/projects/${projectId}`}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        ← Back to project
      </Link>
      <PartnerDocumentView
        pageId={page.id}
        title={page.title}
        collabToken={collabToken}
        userName={userName}
      />
    </div>
  );
}
