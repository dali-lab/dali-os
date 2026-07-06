import type { Route } from "./+types/api.partner-application-domains.$id";
import { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { isEmptyDoc } from "~/components/RichTextViewer";

// POST   /api/partner-application-domains/:id — update expected scope.
//          Body: { expectedMembers: number, expectedChallenges: ProseMirrorDoc|null }
// DELETE /api/partner-application-domains/:id — detach the domain from the
//          application (hard delete; the row is pure join+scope data, nothing
//          references it).
//
// Same permission model as partner-application edit (isCore === Admin ||
// Core).

type Body = {
  expectedMembers: number;
  expectedChallenges: unknown;
};

function isProseMirrorDoc(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  return (x as { type?: unknown }).type === "doc";
}

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  if (typeof r.expectedMembers !== "number") return false;
  if (r.expectedChallenges !== null && !isProseMirrorDoc(r.expectedChallenges))
    return false;
  return true;
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(
      request,
      Response.json({ error: "Method not allowed" }, { status: 405 }),
    );
  }
  if (!(await isCore(auth.user.sub))) {
    return forbidden(request);
  }

  const id = params.id!;

  // P2025 = "record to delete/update does not exist" — let Prisma raise it
  // rather than pre-checking with a separate query.
  function notFound(e: unknown): Response | null {
    if ((e as { code?: string })?.code === "P2025") {
      return withCors(
        request,
        Response.json({ error: "Not found" }, { status: 404 }),
      );
    }
    return null;
  }

  if (request.method === "DELETE") {
    try {
      await prisma.partnerApplicationDomain.delete({ where: { id } });
    } catch (e) {
      const res = notFound(e);
      if (res) return res;
      throw e;
    }
    return withCors(request, Response.json({ ok: true }));
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

  const expectedMembers = Math.max(0, Math.floor(body.expectedMembers));
  const expectedChallenges = isEmptyDoc(body.expectedChallenges)
    ? Prisma.JsonNull
    : (body.expectedChallenges as Prisma.InputJsonValue);

  try {
    await prisma.partnerApplicationDomain.update({
      where: { id },
      data: { expectedMembers, expectedChallenges },
    });
  } catch (e) {
    const res = notFound(e);
    if (res) return res;
    throw e;
  }

  return withCors(request, Response.json({ ok: true }));
}
