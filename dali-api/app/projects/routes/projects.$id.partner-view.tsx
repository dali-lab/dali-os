import { Link, redirect, useLoaderData } from "react-router";
import { Building2 } from "lucide-react";
import type { Route } from "./+types/projects.$id.partner-view";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { loadPartnerProjectView } from "~/partners/lib/partner-project-view.server";
import { PartnerProjectHubView } from "~/partners/components/PartnerProjectHubView";

export const meta: Route.MetaFunction = ({ data }) => {
  const n = (data as { project?: { name: string } } | undefined)?.project?.name;
  return [{ title: n ? `${n} · Partner view · DALI OS` : "Partner view · DALI OS" }];
};

// This route isn't nested under projects/:id (it's a sibling route in
// routes.ts), so Breadcrumbs' generic per-segment walk already renders
// "Projects" for the leading segment on its own; returning just the project
// name here (as the trailing crumb) keeps the trail identical to the plain
// project page's — "Projects > Project Name" — rather than layering a
// redundant "Projects" and an extra "Partner view" leaf on top of it.
export const handle = {
  breadcrumb: (data: unknown) => {
    const d = data as { project?: { name: string } } | undefined;
    return d?.project ? d.project.name : null;
  },
  // Swaps out for the project page's "Partner view" button (same header
  // slot) rather than a separate in-page "back to project" link, so getting
  // back to the internal hub is a toggle in place, not a second control.
  headerAction: (data: unknown) => {
    const d = data as { project?: { id: string } } | undefined;
    if (!d?.project) return null;
    return (
      <Link
        to={`/projects/${d.project.id}`}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors"
      >
        <Building2 className="w-4 h-4" />
        Internal view
      </Link>
    );
  },
};

// Preview of what a partner org sees on the portal's project page — open to
// any signed-in member (same access as the project page itself), not just
// Core or the project team. Same read surface as the real partner portal
// (loadPartnerProjectView), just not scoped to any one partner org, so
// there's no partnerSince to show.
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
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
