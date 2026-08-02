import type { Route } from "./+types/api.page-templates";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { isCore, isLabMember, isProjectMember } from "~/lib/roles";
import { duplicatePage } from "~/lib/page-copy.server";
import type { WorkspaceType } from "~/generated/prisma/client";

// GET  /api/page-templates?workspaceType=Lab&workspaceId=<id>
//   List template pages the viewer can access in the given workspace scope.
//   Returns { templates: Array<{ id, title, iconEmoji }> }.
//
// POST /api/page-templates
//   Body: { templatePageId, targetWorkspaceType, targetWorkspaceId?,
//           targetParentPageId?, title? }
//   Create a new page by duplicating the template content. Returns { id }.

const PostBodySchema = z.object({
  templatePageId: z.string().min(1),
  targetWorkspaceType: z.enum(["Lab", "Project", "EducationOffering", "Member"]),
  targetWorkspaceId: z.string().optional(),
  targetParentPageId: z.string().optional(),
  // Optional title override; if omitted the template title is used as-is.
  title: z.string().trim().min(1).max(200).optional(),
});

async function canViewWorkspace(
  userSub: string,
  workspaceType: string,
  workspaceId: string | null,
): Promise<boolean> {
  const core = await isCore(userSub);
  if (core) return true;
  if (workspaceType === "Lab") return isLabMember(userSub);
  if (workspaceType === "Project" && workspaceId) {
    return isProjectMember(userSub, workspaceId);
  }
  return false;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return withCors(request, Response.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const url = new URL(request.url);
  const workspaceType = url.searchParams.get("workspaceType") as WorkspaceType | null;
  const workspaceId = url.searchParams.get("workspaceId") ?? null;

  if (!workspaceType) {
    return withCors(request, Response.json({ error: "workspaceType required" }, { status: 400 }));
  }

  const canAccess = await canViewWorkspace(auth.user.sub, workspaceType, workspaceId);
  if (!canAccess) {
    return withCors(request, Response.json({ templates: [] }));
  }

  // Templates are pages in the same workspace scope with isTemplate=true.
  const templates = await prisma.page.findMany({
    where: {
      workspaceType,
      workspaceId,
      isTemplate: true,
      archivedAt: null,
      kind: "FreeForm",
    },
    orderBy: { title: "asc" },
    select: { id: true, title: true, iconEmoji: true },
  });

  return withCors(request, Response.json({ templates }));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const auth = await requireAuth(request);
  if (!auth.ok) {
    return withCors(request, Response.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const body = await parseJson(request, PostBodySchema);
  if (body instanceof Response) return withCors(request, body);

  try {
    const result = await duplicatePage({
      sourcePageId: body.templatePageId,
      createdById: auth.user.sub,
      titleOverride: body.title ?? undefined,
      workspaceTypeOverride: body.targetWorkspaceType as WorkspaceType,
      workspaceIdOverride: body.targetWorkspaceId ?? null,
      parentPageIdOverride: body.targetParentPageId ?? null,
    });
    return withCors(request, Response.json({ id: result.id }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    const status = message === "Permission denied" ? 403 : message === "Page not found" ? 404 : 500;
    return withCors(request, Response.json({ error: message }, { status }));
  }
}
