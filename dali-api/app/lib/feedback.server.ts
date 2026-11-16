import { requireLabViewer, labMemberOrCore } from "~/lib/lab-viewer.server";

export async function requireFeedbackViewer(request: Request) {
  const { user, roles } = await requireLabViewer(request, { allow: labMemberOrCore });
  return { user, core: roles.isCore };
}
