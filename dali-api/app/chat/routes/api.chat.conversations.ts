import type { Route } from "./+types/api.chat.conversations";
import { requireMobileUser } from "~/lib/mobile-auth.server";
import { parseJson } from "~/lib/validate";
import { createChannel } from "~/chat/lib/chat.server";
import { createChannelSchema } from "~/chat/lib/chat-rules";
import { methodNotAllowed, respond } from "~/chat/lib/respond.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return methodNotAllowed();
  const auth = await requireMobileUser(request);
  if (!auth.ok) return auth.response;
  const body = await parseJson(request, createChannelSchema);
  if (body instanceof Response) return body;
  return respond(await createChannel(auth.userId, body), (data) => data);
}
