// Admin controls for a background job: PATCH { enabled?, intervalMinutes?,
// settings? } edits it, POST { action: "run" } force-runs it (respecting the
// in-flight lease). intervalMinutes and settings are validated against the
// registry's declared bounds — the row is authoritative at runtime, so bad
// values must not be storable.

import type { Route } from "./+types/api.jobs.$name";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";
import { jobByName, type JobDefinition } from "~/jobs/registry";
import { runJob } from "~/jobs/runner.server";

const PatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    intervalMinutes: z.number().int().min(1).max(1440).optional(),
    settings: z.record(z.string(), z.number()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
const PostSchema = z.object({ action: z.literal("run") });

// Reject unknown keys and out-of-range values rather than silently clamping —
// the panel should never produce them, so a mismatch is a bug worth surfacing.
function validateSettings(
  def: JobDefinition,
  settings: Record<string, number>,
): string | null {
  const defs = new Map((def.settings ?? []).map((s) => [s.key, s]));
  for (const [key, value] of Object.entries(settings)) {
    const sd = defs.get(key);
    if (!sd) return `Unknown setting "${key}"`;
    if (!Number.isFinite(value) || value < sd.min || value > sd.max) {
      return `"${sd.label}" must be between ${sd.min} and ${sd.max}`;
    }
  }
  return null;
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isAdmin(auth.user.sub))) return forbidden(request);

  const name = params.name!;
  const def = jobByName(name);
  if (!def) {
    return Response.json({ error: "Unknown job" }, { status: 404 });
  }

  if (request.method === "PATCH") {
    const parsed = await parseJson(request, PatchSchema);
    if (parsed instanceof Response) return parsed;

    if (parsed.settings) {
      const settingsError = validateSettings(def, parsed.settings);
      if (settingsError) {
        return Response.json({ error: settingsError }, { status: 400 });
      }
    }

    await prisma.scheduledJob.update({
      where: { name },
      data: {
        ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
        ...(parsed.intervalMinutes !== undefined
          ? { intervalMinutes: parsed.intervalMinutes }
          : {}),
        ...(parsed.settings !== undefined ? { settings: parsed.settings } : {}),
      },
    });
    await logAuditEvent({
      action: "jobs.toggle",
      userId: auth.user.sub,
      targetId: name,
      metadata: {
        ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
        ...(parsed.intervalMinutes !== undefined
          ? { intervalMinutes: parsed.intervalMinutes }
          : {}),
        ...(parsed.settings !== undefined ? { settings: parsed.settings } : {}),
      },
      request,
    });
    return Response.json({ ok: true });
  }

  if (request.method === "POST") {
    const parsed = await parseJson(request, PostSchema);
    if (parsed instanceof Response) return parsed;

    const result = await runJob(name, { force: true });
    await logAuditEvent({
      action: "jobs.run",
      userId: auth.user.sub,
      targetId: name,
      metadata: { ran: result.ran, error: result.error ?? null },
      request,
    });
    if (!result.ran) {
      return Response.json({ ok: false, error: result.error }, { status: 409 });
    }
    return Response.json({ ok: true, error: result.error ?? null });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
