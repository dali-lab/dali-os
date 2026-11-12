import type { Route } from "./+types/api.staffing.assign";
import { requireAuth, forbidden } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { isLevel, type Level } from "~/lib/level";
import { assignStaffing, StaffingWriteError } from "../lib/staffing-assign.server";

// POST /api/staffing/assign

type DomainLevelBody = { domainId: string; level: Level };

type Body = {
  userId: string;
  cycleId: string;
  projectId: string | null;
  fromProjectId?: string;
  domainId?: string;
  level?: Level;
  domains?: DomainLevelBody[];
};

function parseDomains(o: Record<string, unknown>): DomainLevelBody[] | null {
  if (Array.isArray(o.domains)) {
    if (o.domains.length === 0) return null;
    const out: DomainLevelBody[] = [];
    for (const item of o.domains) {
      if (!item || typeof item !== "object") return null;
      const d = item as Record<string, unknown>;
      if (typeof d.domainId !== "string" || !isLevel(d.level)) return null;
      out.push({ domainId: d.domainId, level: d.level });
    }
    return out;
  }
  if (typeof o.domainId === "string" && isLevel(o.level)) {
    return [{ domainId: o.domainId, level: o.level }];
  }
  return null;
}

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.userId !== "string") return false;
  if (typeof o.cycleId !== "string") return false;
  if (o.projectId !== null && typeof o.projectId !== "string") return false;
  if (o.fromProjectId !== undefined && typeof o.fromProjectId !== "string") return false;
  if (o.projectId !== null) {
    const domains = parseDomains(o);
    if (!domains) return false;
    (o as Body).domains = domains;
  }
  return true;
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
    await assignStaffing({
      cycleId: body.cycleId,
      userId: body.userId,
      projectId: body.projectId,
      fromProjectId: body.fromProjectId,
      domains: body.domains ?? [],
      actorId: auth.user.sub,
      request,
    });
  } catch (err) {
    if (err instanceof StaffingWriteError) {
      return withCors(request, Response.json({ error: err.message }, { status: err.status }));
    }
    throw err;
  }

  return withCors(request, Response.json({ ok: true }));
}
