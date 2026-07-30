import {
  useLoaderData,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import type { Route } from "./+types/partner.projects.$id";
import { prisma } from "~/lib/db";
import { requirePartner } from "~/partners/lib/partner-auth.server";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import { loadPartnerProjectView } from "~/partners/lib/partner-project-view.server";
import { PartnerProjectHubView } from "~/partners/components/PartnerProjectHubView";

export const meta: Route.MetaFunction = ({ data }) => {
  const n = (data as { project?: { name: string } } | undefined)?.project?.name;
  return [{ title: n ? `${n} · DALI OS` : "Project · DALI OS" }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth, partnerUser } = await requirePartner(request);
  // 404 (not 403) so inaccessible project ids don't leak existence.
  if (!(await partnerHasProjectAccess(auth.user.sub, params.id!))) {
    throw new Response("Not found", { status: 404 });
  }

  const data = await loadPartnerProjectView(
    params.id!,
    partnerUser.partnerOrgId,
    auth.user.sub,
  );
  if (!data) throw new Response("Not found", { status: 404 });

  // Mark this project's hub as seen now, so the next visit's "what's new" feed
  // cuts from this moment. Runs after the load above (which read the prior
  // visit), so the feed the partner sees still reflects their previous visit.
  await prisma.partnerProjectVisit.upsert({
    where: {
      userId_projectId: { userId: auth.user.sub, projectId: params.id! },
    },
    create: {
      userId: auth.user.sub,
      projectId: params.id!,
      lastSeenAt: new Date(),
    },
    update: { lastSeenAt: new Date() },
  });

  return { ...data, currentUserId: auth.user.sub };
}

// The section tabs live entirely in the ?tab= search param and don't change
// the loaded data — skip the refetch (and the "mark seen" write) on those
// client-side navigations. Still revalidate after form submissions.
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (!formMethod && currentUrl.pathname === nextUrl.pathname) return false;
  return defaultShouldRevalidate;
}

export default function PartnerProjectView() {
  const data = useLoaderData<typeof loader>();
  return (
    <PartnerProjectHubView
      data={data}
      currentUserId={data.currentUserId}
      canRsvp
      backLink={{ to: "/partner", label: "Back to portal" }}
      pageHref={(pageId) => `/partner/projects/${data.project.id}/pages/${pageId}`}
    />
  );
}
