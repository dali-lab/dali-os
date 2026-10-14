import type { Route } from "./+types/api.notebooks.default";
import { z } from "zod";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { resolveDefaultNotebook } from "~/lib/notebook-default.server";

// GET /api/notebooks/default?meetingId=&scopeType=&groupId=&projectId=&isCoreMeeting=1
// — { kind: "series" | "history" | "new", notebook, newPath }: the notebook a
// meeting form starts on, and the path a new one would take.

const QuerySchema = z.object({
  meetingId: z.string().min(1).optional(),
  scopeType: z.enum(["Group", "UserList", "None"]),
  groupId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  isCoreMeeting: z.literal("1").optional(),
});

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);

  const params = new URL(request.url).searchParams;
  const parsed = QuerySchema.safeParse({
    meetingId: params.get("meetingId") || undefined,
    scopeType: params.get("scopeType") ?? undefined,
    groupId: params.get("groupId") || undefined,
    projectId: params.get("projectId") || undefined,
    isCoreMeeting: params.get("isCoreMeeting") || undefined,
  });
  if (!parsed.success) {
    return withCors(request, Response.json({ error: "Invalid query" }, { status: 400 }));
  }

  const result = await resolveDefaultNotebook({
    actorId: gate.auth.user.sub,
    meetingId: parsed.data.meetingId,
    scopeType: parsed.data.scopeType,
    groupId: parsed.data.groupId,
    projectId: parsed.data.projectId,
    isCoreMeeting: parsed.data.isCoreMeeting === "1",
    request,
  });
  return withCors(request, Response.json(result));
}
