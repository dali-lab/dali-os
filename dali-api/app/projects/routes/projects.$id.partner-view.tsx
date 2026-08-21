import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.$id.partner-view";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { loadPartnerProjectView } from "~/partners/lib/partner-project-view.server";
import { PartnerProjectHubView } from "~/partners/components/PartnerProjectHubView";
import { ProjectViewSwitch } from "../components/ProjectViewSwitch";
import { ProjectIcon } from "~/components/ProjectIcon";

export const meta: Route.MetaFunction = ({ data }) => {
  const n = (data as { project?: { name: string } } | undefined)?.project?.name;
  return [{ title: n ? `${n} · Partner view · DALI OS` : "Partner view · DALI OS" }];
};

// The trail here reads exactly as the project page's — "Projects > Project
// Name" — rather than layering a redundant "Projects" and an extra "Partner
// view" leaf on top of it. Which view you're in is the header's job (the
// ProjectViewSwitch below), not the trail's.
export const handle = {
  // breadcrumbTrail, not breadcrumb: a leaf label can only rename its OWN
  // segment, and this route's path has an id segment in the middle. Breadcrumbs
  // drops a mid-path id only when it looks opaque (a cuid); project ids here are
  // human-slugged, so `project-dali-os` survived the walk and titlecased itself
  // into a crumb — leaving "Projects › Project Dali Os › DALI OS", the project
  // nested inside a mangled copy of its own id. Declaring the whole trail skips
  // the segment walk entirely and gives the same two crumbs the project page
  // itself renders, icon included.
  breadcrumbTrail: (data: unknown) => {
    const p = (
      data as { project?: { id: string; name: string; iconEmoji: string | null } } | undefined
    )?.project;
    if (!p) return null;
    return [
      { label: "Projects", to: "/projects" },
      {
        label: p.name,
        to: `/projects/${p.id}`,
        icon: <ProjectIcon iconEmoji={p.iconEmoji} />,
      },
    ];
  },
  // Swaps out for the project page's own view switcher (same header slot)
  // rather than a separate in-page "back to project" link, so moving between
  // the three views is a toggle in place, not a second control.
  headerAction: (data: unknown) => {
    const d = data as { project?: { id: string } } | undefined;
    if (!d?.project) return null;
    return <ProjectViewSwitch projectId={d.project.id} current="partner" />;
  },
};

// Preview of what a partner org sees on the portal's project page — open to
// any signed-in member (same access as the project page itself), not just
// Core or the project team. Same read surface as the real partner portal
// (loadPartnerProjectView), just not scoped to any one partner org, so
// there's no partnerSince to show.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const data = await loadPartnerProjectView(params.id!, null);
  if (!data) return redirect("/projects");
  return data;
}

export default function ProjectPartnerViewPreview() {
  const data = useLoaderData<typeof loader>();
  return (
    <PartnerProjectHubView
      data={data}
      pageHref={(pageId) => `/documents/${pageId}`}
    />
  );
}
