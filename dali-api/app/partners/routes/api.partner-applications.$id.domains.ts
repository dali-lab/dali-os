import type { Route } from "./+types/api.partner-applications.$id.domains";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

// POST /api/partner-applications/:id/domains
//
// Attach a domain to a partner application's expected scope. Body:
// { domainId }. expectedMembers defaults to 0 and expectedChallenges to null;
// they're filled in via PUT on the resulting PartnerApplicationDomain.
//
// Same permission model as partner-application edit (isCore === Admin ||
// Core). One row per (application, domain) — enforced by the schema unique.

type Body = { domainId: string };

function isBody(x: unknown): x is Body {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as Record<string, unknown>).domainId === "string"
  );
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
    return withCors(
      request,
      Response.json({ error: "Forbidden" }, { status: 403 }),
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(
      request,
      Response.json({ error: "Invalid JSON" }, { status: 400 }),
    );
  }
  if (!isBody(body)) {
    return withCors(
      request,
      Response.json({ error: "Invalid body" }, { status: 400 }),
    );
  }

  const applicationId = params.id!;
  const [application, domain] = await Promise.all([
    prisma.partnerApplication.findUnique({
      where: { id: applicationId },
      select: { id: true },
    }),
    prisma.domain.findUnique({
      where: { id: body.domainId },
      select: { id: true },
    }),
  ]);
  if (!application) {
    return withCors(
      request,
      Response.json({ error: "Application not found" }, { status: 404 }),
    );
  }
  if (!domain) {
    return withCors(
      request,
      Response.json({ error: "Domain not found" }, { status: 404 }),
    );
  }

  // The (applicationId, domainId) unique constraint is the source of truth
  // for "already attached" — let it raise rather than racing a pre-check.
  try {
    const row = await prisma.partnerApplicationDomain.create({
      data: { applicationId, domainId: body.domainId },
      select: { id: true },
    });
    return withCors(request, Response.json({ id: row.id }));
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") {
      return withCors(
        request,
        Response.json(
          { error: "That domain is already on this application" },
          { status: 409 },
        ),
      );
    }
    throw e;
  }
}
