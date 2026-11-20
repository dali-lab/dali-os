import type { Route } from "./+types/api.alumni-game.quest";
import { requireMemberSession } from "~/lib/auth";
import { isQuestFieldKey } from "~/alumni/lib/quest";
import { acceptQuest, answerQuest, finishQuest } from "~/alumni/lib/quest-chat.server";

export async function action({ request }: Route.ActionArgs) {
  const session = await requireMemberSession(request);
  if (!session.ok) return session.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const userId = session.auth.user.sub;

  const body = (await request.json().catch(() => null)) as {
    intent?: unknown;
    field?: unknown;
    value?: unknown;
    history?: unknown;
    skipped?: unknown;
  } | null;

  if (body?.intent === "accept") {
    const accepted = await acceptQuest(userId);
    if (!accepted) return Response.json({ error: "Create your avatar first" }, { status: 400 });
    return Response.json({ ok: true, ...accepted });
  }

  if (body?.intent === "answer") {
    if (!isQuestFieldKey(body.field) || typeof body.value !== "string") {
      return Response.json({ error: "Invalid answer" }, { status: 400 });
    }
    const result = await answerQuest({
      request,
      userId,
      firstName: session.auth.user.firstName ?? "",
      field: body.field,
      value: body.value,
      skipped: body.skipped,
      history: body.history,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    const { ok, profile, percent, say, savedField } = result;
    return Response.json({ ok, profile, percent, say, savedField });
  }

  if (body?.intent === "finish") {
    if (!(await finishQuest(userId, body.skipped))) {
      return Response.json({ error: "There are questions left" }, { status: 400 });
    }
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}
