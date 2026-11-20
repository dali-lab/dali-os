import { requireLabViewer } from "~/lib/lab-viewer.server";

export type OpportunityViewer = { userId: string; core: boolean; alumni: boolean };

export const canPostJob = (viewer: OpportunityViewer) => viewer.core || viewer.alumni;

export async function requireOpportunityViewer(request: Request) {
  const { user, roles } = await requireLabViewer(request);
  const viewer: OpportunityViewer = { userId: user.sub, core: roles.isCore, alumni: roles.isAlumni };
  return viewer;
}
