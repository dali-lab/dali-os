import { redirect } from "react-router";
import type { Route } from "./+types/api.files.$id.download";
import { requireAuth, isNonMember, redirectPartnerToPortal } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { prisma } from "~/lib/db.server";
import { canViewFile } from "~/lib/fileAccess.server";
import { redirectToLogin } from "~/lib/login-next";
import { downloadFileName } from "~/lib/file-download-name";
import { getDownloadUrl, isS3Configured } from "~/lib/s3";

const LINK_SECONDS = 5 * 60;
const VERSION_SELECT = { id: true, fileName: true, s3Key: true } as const;

// GET /api/files/:id/download?version= — saves the file (current version unless
// one is named). Links here never go stale the way a signed S3 URL in a page
// does. Don't add a `download` attribute to links here: the desktop webview
// cancels those.
export async function loader({ request, params }: Route.LoaderArgs) {
  const notFound = () => new Response("Not found", { status: 404 });

  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if ((await isNonMember(auth, request)) || (await redirectPartnerToPortal(auth))) return notFound();

  const file = await prisma.projectFile.findUnique({
    where: { id: params.id },
    select: {
      title: true,
      archivedAt: true,
      projectId: true,
      workspaceType: true,
      workspaceId: true,
      folderPageId: true,
      currentVersion: { select: VERSION_SELECT },
    },
  });
  if (!file || file.archivedAt !== null) return notFound();
  if (!(await canViewFile(auth.user.sub, file, request))) return notFound();

  const versionId = new URL(request.url).searchParams.get("version");
  const version = versionId
    ? await prisma.projectFileVersion.findFirst({
        where: { id: versionId, fileId: params.id },
        select: VERSION_SELECT,
      })
    : file.currentVersion;
  if (!version) return notFound();

  await logAuditEvent({
    action: "projectFile.download",
    userId: auth.user.sub,
    targetId: params.id,
    metadata: { versionId: version.id },
    request,
  });

  if (!isS3Configured()) return redirect(`/api/upload/raw?key=${encodeURIComponent(version.s3Key)}`);
  return redirect(
    await getDownloadUrl(version.s3Key, {
      fileName: downloadFileName(file.title, version.fileName),
      expiresIn: LINK_SECONDS,
    }),
  );
}
