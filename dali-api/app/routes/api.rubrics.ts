import type { Route } from "./+types/api.rubrics";
import { requireAuth, forbidden } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { editableFolderInRoot, ensureRoot } from "~/drive/lib/drive-roots.server";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;
  if (!(await isCore(userId, request))) return forbidden(request);

  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return Response.json({ error: "Enter a name" }, { status: 400 });

  const requestedFolder = (formData.get("folderPageId") as string | null) || null;
  const folderPageId =
    (await editableFolderInRoot(userId, requestedFolder, "hiring", request)) ?? (await ensureRoot("hiring", userId));

  const rubric = await prisma.rubric.create({ data: { name, folderPageId }, select: { id: true } });
  await logAuditEvent({
    action: "rubric.create",
    userId,
    targetId: rubric.id,
    metadata: { folderPageId },
    request,
  });
  return Response.json({ ok: true, rubricId: rubric.id });
}
