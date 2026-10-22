import type { Route } from "./+types/api.chat.messages.$id.reactions";
import { requireMobileUser } from "~/lib/mobile-auth.server";
import { parseJson } from "~/lib/validate";
import { toggleReaction } from "~/chat/lib/chat.server";
import { reactionSchema } from "~/chat/lib/chat-rules";
import { methodNotAllowed, respond } from "~/chat/lib/respond.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return methodNotAllowed();
  const auth = await requireMobileUser(request);
  if (!auth.ok) return auth.response;
  const body = await parseJson(request, reactionSchema);
  if (body instanceof Response) return body;
  return respond(await toggleReaction(auth.userId, params.id, body.emoji), (message) => ({ message }));
}
