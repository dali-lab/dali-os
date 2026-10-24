import type { Route } from "./+types/api.partner-application-target-terms.$id";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import {
  PARTNER_PLANNING_STATUSES,
  type PartnerPlanningStatus,
} from "../lib/partner-planning";

// POST /api/partner-application-target-terms/:id — update the Partner Relations
// term plan for a single (application, term) pair. Mirrors
// api.partner-application-domains.$id.ts (same permission model: isCore).
//
// Body (partial): { planningStatus?: PartnerPlanningStatus|null,
//                   plannerNotes?: string|null,
//                   plannerTodo?: string|null }

type Body = {
  planningStatus?: PartnerPlanningStatus | null;
  plannerNotes?: string | null;
  plannerTodo?: string | null;
};

function parseBody(x: unknown): Body | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  const out: Body = {};
  if ("planningStatus" in r) {
    const v = r.planningStatus;
    if (v === null) out.planningStatus = null;
    else if (
      typeof v === "string" &&
      (PARTNER_PLANNING_STATUSES as readonly string[]).includes(v)
    )
      out.planningStatus = v as PartnerPlanningStatus;
    else return null;
  }
  if ("plannerNotes" in r) {
    const v = r.plannerNotes;
    if (v === null || v === "") out.plannerNotes = null;
    else if (typeof v === "string") out.plannerNotes = v;
    else return null;
  }
  if ("plannerTodo" in r) {
    const v = r.plannerTodo;
    if (v === null || v === "") out.plannerTodo = null;
    else if (typeof v === "string") out.plannerTodo = v;
    else return null;
  }
  return out;
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(
      request,
      Response.json({ error: "Method not allowed" }, { status: 405 }),
    );
  }
  if (!(await isCore(auth.user.sub))) {
    return forbidden(request);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return withCors(
      request,
      Response.json({ error: "Invalid JSON" }, { status: 400 }),
    );
  }
  const body = parseBody(raw);
  if (!body) {
    return withCors(
      request,
      Response.json({ error: "Invalid body" }, { status: 400 }),
    );
  }

  try {
    await prisma.partnerApplicationTargetTerm.update({
      where: { id: params.id! },
      data: body,
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") {
      return withCors(
        request,
        Response.json({ error: "Not found" }, { status: 404 }),
      );
    }
    throw e;
  }

  return withCors(request, Response.json({ ok: true }));
}
