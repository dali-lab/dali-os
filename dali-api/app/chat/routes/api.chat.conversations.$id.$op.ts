import type { Route } from "./+types/api.chat.conversations.$id.$op";
import { mobileError, requireMobileUser } from "~/lib/mobile-auth.server";
import { parseJson } from "~/lib/validate";
import { inviteMembers, joinChannel, leaveChannel, markRead } from "~/chat/lib/chat.server";
import { membersSchema, readSchema } from "~/chat/lib/chat-rules";
import { methodNotAllowed, respond } from "~/chat/lib/respond.server";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return methodNotAllowed();
  const auth = await requireMobileUser(request);
  if (!auth.ok) return auth.response;
  const { id } = params;

  switch (params.op) {
    case "join":
      return respond(await joinChannel(auth.userId, id), (data) => data);
    case "leave":
      return respond(await leaveChannel(auth.userId, id), () => ({ ok: true }));
    case "members": {
      const body = await parseJson(request, membersSchema);
      if (body instanceof Response) return body;
      return respond(await inviteMembers(auth.userId, id, body.userIds), (data) => data);
    }
    case "read": {
      const body = await parseJson(request, readSchema);
      if (body instanceof Response) return body;
      return respond(await markRead(auth.userId, id, new Date(body.at)), () => ({ ok: true }));
    }
    default:
      return mobileError("Not found", 404);
  }
}
