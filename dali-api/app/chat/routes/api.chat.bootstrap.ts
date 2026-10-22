import type { Route } from "./+types/api.chat.bootstrap";
import { mobileJson, requireMobileUser } from "~/lib/mobile-auth.server";
import { listMemberSummaries } from "~/lib/mobile-members.server";
import { bootstrap } from "~/chat/lib/chat.server";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireMobileUser(request);
  if (!auth.ok) return auth.response;
  const [users, chat] = await Promise.all([listMemberSummaries(), bootstrap(auth.userId)]);
  return mobileJson({ meId: auth.userId, users, ...chat });
}
