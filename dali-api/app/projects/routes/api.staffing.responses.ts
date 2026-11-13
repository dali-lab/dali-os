import type { Route } from "./+types/api.staffing.responses";
import { prisma } from "~/lib/db.server";
import { requireAuth, forbidden } from "~/lib/auth";
import { primaryEmail } from "~/lib/display";
import { canManageStaffing, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { isSlot } from "~/projects/lib/form-slots";
import { memberSearchWhere } from "~/projects/lib/member-search";
import { buildPublicForm, submitStaffingFormFor } from "~/forms/lib/public-form";

// A staffing manager adding a response to a board for a member who didn't
// fill the form.
//
//   GET  ?cycleId=&slot=&q=       members matching q who have no response yet
//   GET  ?cycleId=&slot=&userId=  the form as that member would fill it
//   POST { cycleId, slot, userId, versionId, versionUpdatedAt, answers }

async function gate(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { response: auth.response };
  const userId = auth.user.sub;
  if (!(await canManageStaffing(userId))) return { response: forbidden(request) };
  if (!(await isFeatureEnabled("form-response-views", userId, await getUserRoles(userId, request), request)))
    return { response: forbidden(request) };
  return { userId };
}

const bad = (error: string, status = 400) => Response.json({ error }, { status });

async function respondedUserIds(cycleId: string, slot: string): Promise<Set<string>> {
  const rows = await prisma.formSubmission.findMany({
    where: { staffingCycleId: cycleId, slot, userId: { not: null } },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId!));
}

export async function loader({ request }: Route.LoaderArgs) {
  const g = await gate(request);
  if ("response" in g) return g.response;
  const params = new URL(request.url).searchParams;
  const cycleId = params.get("cycleId") ?? "";
  const slot = params.get("slot") ?? "";
  if (!cycleId || !isSlot(slot)) return bad("Pick a board and term.");

  const userId = params.get("userId");
  if (userId) {
    if ((await respondedUserIds(cycleId, slot)).has(userId))
      return bad("They already have a response for this term. Delete it first to replace it.", 409);
    const binding = await prisma.staffingCycleFormBinding.findUnique({
      where: { staffingCycleId_slot: { staffingCycleId: cycleId, slot } },
      select: {
        form: {
          select: {
            id: true,
            name: true,
            publicToken: true,
            page: { select: { iconEmoji: true } },
            versions: {
              orderBy: { versionNumber: "desc" },
              take: 1,
              select: { id: true, questions: true, intro: true, updatedAt: true },
            },
            cycleBindings: {
              select: {
                slot: true,
                updatedAt: true,
                formVersionId: true,
                staffingCycle: { select: { term: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });
    const form = binding?.form;
    const version = form?.versions[0];
    if (!form || !version) return bad("No form is connected for this term.", 404);
    const served = await buildPublicForm(form, version, userId);
    return Response.json({ form: { ...served, token: form.publicToken ?? "" } });
  }

  const q = (params.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ results: [] });
  const [responded, users] = await Promise.all([
    respondedUserIds(cycleId, slot),
    prisma.user.findMany({
      where: memberSearchWhere(q),
      select: { id: true, firstName: true, lastName: true, daliEmail: true, dartmouthEmail: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 25,
    }),
  ]);
  return Response.json({
    results: users
      .filter((u) => !responded.has(u.id))
      .slice(0, 10)
      .map((u) => ({
        userId: u.id,
        name: `${u.firstName} ${u.lastName}`.trim(),
        email: primaryEmail(u) ?? null,
      })),
  });
}

export async function action({ request }: Route.ActionArgs) {
  const g = await gate(request);
  if ("response" in g) return g.response;
  if (request.method !== "POST") return bad("Method not allowed", 405);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !body ||
    typeof body.cycleId !== "string" ||
    typeof body.userId !== "string" ||
    typeof body.versionId !== "string" ||
    typeof body.slot !== "string" ||
    !isSlot(body.slot) ||
    !body.answers ||
    typeof body.answers !== "object" ||
    Array.isArray(body.answers)
  )
    return bad("Invalid input");
  const result = await submitStaffingFormFor({
    staffingCycleId: body.cycleId,
    slot: body.slot,
    userId: body.userId,
    enteredById: g.userId,
    versionId: body.versionId,
    versionUpdatedAt: typeof body.versionUpdatedAt === "string" ? body.versionUpdatedAt : undefined,
    answers: body.answers as Record<string, unknown>,
    request,
  });
  if ("error" in result) return bad(result.error, result.status);
  return Response.json({ ok: true });
}
