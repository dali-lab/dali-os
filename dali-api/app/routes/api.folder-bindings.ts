import type { Route } from "./+types/api.folder-bindings";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { isOfferingManager } from "~/education/lib/access.server";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import {
  FOLDER_SLOTS,
  CORE_PROCESS_ID,
  listBindings,
  setBinding,
  ensureProcessFolder,
  type ProcessType,
} from "~/lib/bindings.server";

// GET  /api/folder-bindings?processType=&processId=  → slots + current bindings
//                                                       + candidate folders
// POST /api/folder-bindings  { processType, processId, purpose, intent, folderPageId? }
//   intent="create" → create a fresh folder and bind it
//   intent="set"    → point the slot at an existing folder (folderPageId)
//   intent="clear"  → unbind the slot
//
// The process→folder binding is the editable relation behind the "Drive folders"
// section of a project / offering / cycle / Core settings surface (see
// app/lib/bindings.server.ts). Authorization is per process type.

const PROCESS_TYPES = ["Project", "EducationOffering", "HiringCycle", "Core"] as const;

// Can `userId` manage the folder bindings of this process? Mirrors each area's
// existing "manage settings" gate; Core role is a superset everywhere.
async function canManageProcess(
  userId: string,
  processType: ProcessType,
  processId: string,
  request: Request,
): Promise<boolean> {
  if (await isCore(userId, request)) return true;
  switch (processType) {
    case "Project":
      return isProjectMember(userId, processId, request);
    case "EducationOffering":
      return isOfferingManager(userId, processId);
    case "HiringCycle":
    case "Core":
      // Hiring + Core governance bindings are Core-only (Core check above).
      return false;
  }
}

// The workspace whose folders are offered as "choose existing" candidates for
// this process. Projects/offerings show their own workspace; Core/hiring show
// the Lab workspace.
function candidateWhere(processType: ProcessType, processId: string) {
  const base = { kind: "Folder" as const, archivedAt: null };
  switch (processType) {
    case "Project":
      return { ...base, workspaceType: "Project" as const, workspaceId: processId };
    case "EducationOffering":
      return { ...base, workspaceType: "EducationOffering" as const, workspaceId: processId };
    case "HiringCycle":
    case "Core":
      return { ...base, workspaceType: "Lab" as const, workspaceId: null };
  }
}

function normalizeProcessId(processType: ProcessType, processId: string): string {
  return processType === "Core" ? CORE_PROCESS_ID : processId;
}

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const url = new URL(request.url);
  const processTypeRaw = url.searchParams.get("processType");
  const processIdRaw = url.searchParams.get("processId") ?? "";
  if (!processTypeRaw || !PROCESS_TYPES.includes(processTypeRaw as ProcessType)) {
    return withCors(request, Response.json({ error: "Bad processType" }, { status: 400 }));
  }
  const processType = processTypeRaw as ProcessType;
  const processId = normalizeProcessId(processType, processIdRaw);

  if (!(await canManageProcess(auth.user.sub, processType, processId, request))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const [bindings, candidates] = await Promise.all([
    listBindings(processType, processId),
    prisma.page.findMany({
      where: candidateWhere(processType, processId),
      select: { id: true, title: true },
      orderBy: { position: "asc" },
    }),
  ]);

  const byPurpose = new Map(bindings.map((b) => [b.purpose, b]));
  const rows = FOLDER_SLOTS[processType].map((slot) => {
    const b = byPurpose.get(slot.purpose);
    return {
      purpose: slot.purpose,
      label: slot.label,
      folderPageId: b?.folderPageId ?? null,
      folderTitle: b?.folderTitle ?? null,
      missing: b?.missing ?? false,
    };
  });

  return withCors(request, Response.json({ processType, processId, rows, candidates }));
}

const BodySchema = z.object({
  processType: z.enum(PROCESS_TYPES),
  processId: z.string().default(""),
  purpose: z.string().min(1),
  intent: z.enum(["create", "set", "clear"]),
  folderPageId: z.string().min(1).nullable().optional(),
});

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);
  const { processType, purpose, intent } = body;
  const processId = normalizeProcessId(processType, body.processId);

  if (!FOLDER_SLOTS[processType].some((s) => s.purpose === purpose)) {
    return withCors(request, Response.json({ error: "Unknown slot" }, { status: 400 }));
  }
  if (!(await canManageProcess(auth.user.sub, processType, processId, request))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  if (intent === "create") {
    // Clear any stale binding first so ensureProcessFolder provisions a fresh
    // folder rather than returning a deleted/missing one.
    await setBinding(processType, processId, purpose, null, auth.user.sub);
    const folderPageId = await ensureProcessFolder({
      processType,
      processId,
      purpose,
      createdById: auth.user.sub,
    });
    return withCors(request, Response.json({ ok: true, folderPageId }));
  }

  if (intent === "set") {
    const folderPageId = body.folderPageId ?? null;
    if (folderPageId) {
      // Validate the target is a real, non-archived Folder the user can see in
      // this process's candidate set.
      const ok = await prisma.page.findFirst({
        where: { id: folderPageId, ...candidateWhere(processType, processId) },
        select: { id: true },
      });
      if (!ok) return withCors(request, Response.json({ error: "Bad folder" }, { status: 400 }));
    }
    await setBinding(processType, processId, purpose, folderPageId, auth.user.sub);
    return withCors(request, Response.json({ ok: true, folderPageId }));
  }

  // clear
  await setBinding(processType, processId, purpose, null, auth.user.sub);
  return withCors(request, Response.json({ ok: true, folderPageId: null }));
}
