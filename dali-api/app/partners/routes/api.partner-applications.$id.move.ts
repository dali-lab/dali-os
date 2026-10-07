import type { Route } from "./+types/api.partner-applications.$id.move";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { isPartnerStage } from "../lib/partner-application";
import { setApplicationStage } from "../lib/partner-activity.server";

// POST /api/partner-applications/:id/move
//
// Move an application within the board (drag-and-drop). Mirrors
// api.tasks.$id.move.ts. Body is one of:
//   { stage, orderedIds } — orderedIds is the target column's full
//     application id list (including :id) in display order; every listed
//     application's position is renumbered to its index, and :id gets
//     `stage` via setApplicationStage (so the stage change is activity-logged
//     the same as any other stage move). Handles both cross-column moves and
//     within-column reordering.
//   { stage, position }   — legacy append-to-end shape.
// Same permission model as the board's other write endpoints (isCore).

type Body =
  | { stage: string; orderedIds: string[]; position?: undefined }
  | { stage: string; position: number; orderedIds?: undefined };

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.stage !== "string") return false;
  if (Array.isArray(o.orderedIds)) {
    return o.orderedIds.every((id) => typeof id === "string");
  }
  return typeof o.position === "number";
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await isCore(auth.user.sub))) {
    return forbidden(request);
  }

  const application = await prisma.partnerApplication.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!application) {
    return withCors(request, Response.json({ error: "Application not found" }, { status: 404 }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }
  if (!isPartnerStage(body.stage)) {
    return withCors(request, Response.json({ error: "Invalid stage" }, { status: 400 }));
  }
  const stage = body.stage;

  if (body.orderedIds !== undefined) {
    if (!body.orderedIds.includes(params.id!)) {
      return withCors(
        request,
        Response.json({ error: "orderedIds must include the moved application" }, { status: 400 }),
      );
    }
    const listed = await prisma.partnerApplication.findMany({
      where: { id: { in: body.orderedIds } },
      select: { id: true },
    });
    if (listed.length !== body.orderedIds.length) {
      return withCors(
        request,
        Response.json({ error: "orderedIds must be existing partner applications" }, { status: 400 }),
      );
    }
    const orderedIds = body.orderedIds;
    await prisma.$transaction(async (tx) => {
      // setApplicationStage is the chokepoint so the stage move is
      // activity-logged (a no-op log when the card is just reordered in
      // place); the loop below then renumbers every listed card densely,
      // overwriting whatever placeholder position that call wrote.
      await setApplicationStage(tx, {
        applicationId: params.id!,
        to: stage,
        actorUserId: auth.user.sub,
      });
      await Promise.all(
        orderedIds.map((id, index) =>
          tx.partnerApplication.update({ where: { id }, data: { position: index } }),
        ),
      );
    });
  } else {
    await prisma.$transaction(async (tx) => {
      await setApplicationStage(tx, {
        applicationId: params.id!,
        to: stage,
        actorUserId: auth.user.sub,
        data: { position: body.position },
      });
    });
  }

  return withCors(request, Response.json({ ok: true }));
}
