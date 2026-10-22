import type { Route } from "./+types/api.chat.dms";
import { requireMobileUser } from "~/lib/mobile-auth.server";
import { parseJson } from "~/lib/validate";
import { openDirectMessage } from "~/chat/lib/chat.server";
import { openDmSchema } from "~/chat/lib/chat-rules";
import { methodNotAllowed, respond } from "~/chat/lib/respond.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return methodNotAllowed();
  const auth = await requireMobileUser(request);
  if (!auth.ok) return auth.response;
  const body = await parseJson(request, openDmSchema);
  if (body instanceof Response) return body;
  return respond(await openDirectMessage(auth.userId, body.userIds), (conversation) => ({ conversation }));
}
