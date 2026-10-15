import type { Route } from "./+types/api.folder-receivers";
import { z } from "zod";
import { requireAuth } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import {
  RECEIVER_SLOTS,
  RECEIVER_LABELS,
  ReceiverError,
  acceptsReceiver,
  clearReceiver,
  findReceiver,
  folderPath,
  isReceiverProcessType,
  receiverProcessId,
  setReceiver,
  type ReceiverFolderType,
  type ReceiverProcessType,
  type ReceiverSlot,
} from "~/lib/drive-receivers.server";

// GET  /api/folder-receivers?processType=&processId=
//        -> { slots: [{ folderType, label, folder: { id, title, path } | null }] }
// POST /api/folder-receivers
//        { intent: "set", processType, processId?, folderType, folderId }
//        { intent: "clear", processType, processId?, folderType }
//
// A folder says what it receives (Page.folderType + processType/processId); see
// app/lib/drive-receivers.server.ts. Core decides where lab-wide filing lands; a
// project's own members decide where its meetings land.

const PROCESS_TYPES = Object.keys(RECEIVER_SLOTS) as [ReceiverProcessType, ...ReceiverProcessType[]];
const FOLDER_TYPES = Object.keys(RECEIVER_LABELS) as [ReceiverFolderType, ...ReceiverFolderType[]];

async function canManageReceivers(
  userId: string,
  processType: ReceiverProcessType,
  processId: string,
  request: Request,
): Promise<boolean> {
  if (await isCore(userId, request)) return true;
  return processType === "Project" && !!processId && isProjectMember(userId, processId, request);
}

function json(request: Request, body: unknown, status = 200) {
  return withCors(request, Response.json(body, { status }));
}

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const url = new URL(request.url);
  const processType = url.searchParams.get("processType") ?? "";
  if (!isReceiverProcessType(processType)) return json(request, { error: "Bad processType" }, 400);
  const processId = receiverProcessId(processType, url.searchParams.get("processId"));
  if (!processId) return json(request, { error: "Bad processId" }, 400);

  if (!(await canManageReceivers(auth.user.sub, processType, processId, request))) {
    return json(request, { error: "Forbidden" }, 403);
  }

  const slots = await Promise.all(
    RECEIVER_SLOTS[processType].map(async (folderType) => {
      const id = await findReceiver({ processType, processId, folderType });
      const path = id ? await folderPath(id) : [];
      const folder = id ? { id, title: path[path.length - 1]?.title ?? "", path } : null;
      return { folderType, label: RECEIVER_LABELS[folderType], folder };
    }),
  );
  return json(request, { slots });
}

const SlotFields = {
  processType: z.enum(PROCESS_TYPES),
  processId: z.string().optional(),
  folderType: z.enum(FOLDER_TYPES),
};

const BodySchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("set"), ...SlotFields, folderId: z.string().min(1) }),
  z.object({ intent: z.literal("clear"), ...SlotFields }),
]);

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") return json(request, { error: "Method not allowed" }, 405);
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.sub;

  const body = await parseJson(request, BodySchema);
  if (body instanceof Response) return withCors(request, body);

  try {
    const processId = receiverProcessId(body.processType, body.processId);
    if (!processId) return json(request, { error: "Bad processId" }, 400);
    if (!acceptsReceiver(body.processType, body.folderType)) return json(request, { error: "Unknown slot" }, 400);
    if (!(await canManageReceivers(userId, body.processType, processId, request))) {
      return json(request, { error: "Forbidden" }, 403);
    }
    const slot: ReceiverSlot = { processType: body.processType, processId, folderType: body.folderType };

    if (body.intent === "set") {
      await setReceiver(slot, body.folderId, userId);
      return json(request, { ok: true, folderId: body.folderId });
    }
    const clearedFolderId = await clearReceiver(slot, userId);
    return json(request, { ok: true, clearedFolderId });
  } catch (err) {
    if (err instanceof ReceiverError) return json(request, { error: err.message }, err.status);
    throw err;
  }
}
