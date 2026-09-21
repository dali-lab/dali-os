import type { Route } from "./+types/portal.education.$offeringId.file.$fileId";
import { redirect } from "react-router";
import { requireEnrollment } from "~/education/lib/access.server";
import { prisma } from "~/lib/db";
import { getDownloadUrl } from "~/lib/s3";

// Portal (Dartmouth student) access to an offering's uploaded file. The member
// file viewer (/documents/file/:id) lives in the member shell, which redirects
// non-member Dartmouth students to /portal — so portal students reach their
// timeline files here instead. Enrollment-gated, scoped to this offering, then
// a redirect to the presigned S3 URL (inline) so the browser renders/downloads
// it. Read-only: no versions/comments UI, which portal students don't get.
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireEnrollment(request, params.offeringId!, "portal");

  const file = await prisma.projectFile.findUnique({
    where: { id: params.fileId! },
    select: {
      workspaceType: true,
      workspaceId: true,
      archivedAt: true,
      currentVersion: { select: { s3Key: true, contentType: true } },
    },
  });
  if (
    !file ||
    file.archivedAt !== null ||
    file.workspaceType !== "EducationOffering" ||
    file.workspaceId !== params.offeringId ||
    !file.currentVersion
  ) {
    throw new Response("Not found", { status: 404 });
  }

  const url = await getDownloadUrl(file.currentVersion.s3Key, {
    contentType: file.currentVersion.contentType ?? undefined,
    inline: true,
  });
  return redirect(url);
}
