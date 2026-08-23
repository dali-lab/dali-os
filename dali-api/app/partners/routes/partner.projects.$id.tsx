import { useLoaderData } from "react-router";
import type { Route } from "./+types/partner.projects.$id";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { partnerHasProjectAccess } from "~/partners/lib/partner-access";
import {
  loadPartnerProjectView,
  resolvePartnerProjectOrgId,
} from "~/partners/lib/partner-project-view.server";
import { PartnerProjectHubView } from "~/partners/components/PartnerProjectHubView";

export const meta: Route.MetaFunction = ({ data }) => {
  const n = (data as { project?: { name: string } } | undefined)?.project?.name;
  return [{ title: n ? `${n} · DALI OS` : "Project · DALI OS" }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const ctx = await requirePartnerAccount(request);
  // 404 (not 403) so inaccessible project ids don't leak existence.
  if (!(await partnerHasProjectAccess(ctx.auth.user.sub, params.id!))) {
    throw new Response("Not found", { status: 404 });
  }

  // Resolve which of the account's orgs holds the active partnership with this
  // project so loadPartnerProjectView can surface the correct partnerSince date.
  const partnerOrgId = await resolvePartnerProjectOrgId(
    params.id!,
    ctx.memberships.map((m) => m.orgId),
  );

  const data = await loadPartnerProjectView(params.id!, partnerOrgId);
  if (!data) throw new Response("Not found", { status: 404 });
  return data;
}

export default function PartnerProjectView() {
  const data = useLoaderData<typeof loader>();
  return (
    <PartnerProjectHubView
      data={data}
      backLink={{ to: "/partner", label: "Back to portal" }}
      pageHref={(pageId) => `/partner/projects/${data.project.id}/pages/${pageId}`}
    />
  );
}
