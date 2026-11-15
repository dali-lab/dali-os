import type { Route } from "./+types/api.staffing.eligibility";
import { requireAuth, forbidden } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { isLevel, type Level } from "~/lib/level";
import { setDomainEligibility, StaffingWriteError } from "../lib/staffing-assign.server";

// POST /api/staffing/eligibility

type Body = {
  cycleId: string;
  userId: string;
  domainId: string;
  level: Level;
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.cycleId === "string" &&
    typeof o.userId === "string" &&
    typeof o.domainId === "string" &&
    isLevel(o.level)
  );
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  if (!(await canManageStaffing(auth.user.sub))) {
    return forbidden(request);
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

  try {
    const { domainName } = await setDomainEligibility({
      cycleId: body.cycleId,
      userId: body.userId,
      domainId: body.domainId,
      level: body.level,
      actorId: auth.user.sub,
      request,
    });
    return withCors(
      request,
      Response.json({ ok: true, domainId: body.domainId, domainName, level: body.level }),
    );
  } catch (err) {
    if (err instanceof StaffingWriteError) {
      return withCors(request, Response.json({ error: err.message }, { status: err.status }));
    }
    throw err;
  }
}
