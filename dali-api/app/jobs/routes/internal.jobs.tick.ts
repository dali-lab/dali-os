// Manual/external trigger for the background job runner. The in-process 60s
// interval is the primary driver; this route exists for E2E tests, local
// debugging, and any future external cron. Auth is either the shared secret
// header (machine callers) or an authenticated Admin session (the E2E suite
// and curl-while-logged-in — no CI secret needed).

import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { tick, runJob } from "~/jobs/runner.server";
import type { Route } from "./+types/internal.jobs.tick";

const BodySchema = z.object({ job: z.string().optional() }).nullable();

async function authorized(request: Request): Promise<boolean> {
  const secret = process.env.JOBS_TICK_SECRET;
  const header = request.headers.get("x-jobs-secret");
  if (secret && header === secret) return true;

  const auth = await requireAuth(request);
  if (!auth.ok || auth.user.type === "applicant") return false;
  return isAdmin(auth.user.sub);
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await authorized(request))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof BodySchema> = null;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    // No/invalid JSON body → full tick.
  }

  if (body?.job) {
    const result = await runJob(body.job, { force: true });
    if (!result.ran) {
      return Response.json({ ok: false, error: result.error }, { status: 409 });
    }
    return Response.json({ ok: true, ran: [body.job], error: result.error ?? null });
  }

  const ran = await tick();
  return Response.json({ ok: true, ran });
}

// GET: tiny status snapshot for debugging (same auth).
export async function loader({ request }: Route.LoaderArgs) {
  if (!(await authorized(request))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const jobs = await prisma.scheduledJob.findMany({ orderBy: { name: "asc" } });
  return Response.json({ jobs });
}
