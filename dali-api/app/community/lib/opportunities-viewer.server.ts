import { requireLabViewer } from "~/lib/lab-viewer.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

export type OpportunityViewer = { userId: string; core: boolean; alumni: boolean };

export const canPostJob = (viewer: OpportunityViewer) => viewer.core || viewer.alumni;

export async function requireOpportunityViewer(request: Request) {
  const { user, roles } = await requireLabViewer(request, { flag: "community" });
  const enabled = await isFeatureEnabled("alumni-opportunities", user.sub, roles, request);
  const viewer: OpportunityViewer = { userId: user.sub, core: roles.isCore, alumni: roles.isAlumni };
  return { viewer, enabled };
}

export async function requireOpportunityViewerEnabled(request: Request) {
  const { viewer, enabled } = await requireOpportunityViewer(request);
  if (!enabled) throw new Response("Not found", { status: 404 });
  return viewer;
}
