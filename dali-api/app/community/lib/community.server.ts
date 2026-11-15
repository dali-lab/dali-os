import { requireLabViewer } from "~/lib/lab-viewer.server";

// Same audience as Community: current members and alumni, behind the `community` flag.
export async function requireCommunityViewer(request: Request) {
  const { user, roles } = await requireLabViewer(request, { flag: "community" });
  return { user, core: roles.isCore };
}
