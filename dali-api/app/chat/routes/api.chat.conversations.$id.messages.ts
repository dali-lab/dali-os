import type { Route } from "./+types/api.chat.conversations.$id.messages";
import { mobileError, requireMobileUser } from "~/lib/mobile-auth.server";
import { parseJson } from "~/lib/validate";
import { listMessages, sendMessage } from "~/chat/lib/chat.server";
import { sendMessageSchema } from "~/chat/lib/chat-rules";
import { methodNotAllowed, respond } from "~/chat/lib/respond.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireMobileUser(request);
  if (!auth.ok) return auth.response;
  const raw = new URL(request.url).searchParams.get("before");
  const before = raw ? new Date(raw) : undefined;
  if (before && Number.isNaN(before.getTime())) return mobileError("Invalid before", 400);
  return respond(await listMessages(auth.userId, params.id, before), (messages) => ({ messages }));
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return methodNotAllowed();
  const auth = await requireMobileUser(request);
  if (!auth.ok) return auth.response;
  const body = await parseJson(request, sendMessageSchema);
  if (body instanceof Response) return body;
  return respond(await sendMessage(auth.userId, params.id, body.text, body.parentId), (message) => ({ message }));
}
