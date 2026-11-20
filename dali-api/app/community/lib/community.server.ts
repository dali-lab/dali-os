import { requireLabViewer } from "~/lib/lab-viewer.server";

// Same audience as Community: current members and alumni.
export async function requireCommunityViewer(request: Request) {
  const { user, roles } = await requireLabViewer(request);
  return { user, core: roles.isCore };
}
