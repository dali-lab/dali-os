import type { Route } from "./+types/api.delibs.$id.moves";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isHiringLead, isDomainLead, hasCycleAccess } from "~/lib/roles";
import { INITIAL_COLUMNS, FINAL_COLUMNS } from "~/hiring/lib/delibs";
import { parseJson } from "~/lib/validate";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";

const MoveSchema = z.object({
  cardId: z.string().min(1).max(100),
  toColumn: z.string().min(1).max(100),
  position: z.number().int().min(0).max(10_000).optional(),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return withAuth(auth, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const hiringLead = await isHiringLead(auth.user.sub);
  const domainLead = await isDomainLead(auth.user.sub);
  if (!hiringLead && !domainLead) {
    return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));
  }


  const sessionForAuth = await prisma.delibsSession.findUnique({
    where: { id: params.id },
    select: { applicationCycleId: true },
  });
  if (!sessionForAuth) {
    return withAuth(auth, Response.json({ error: "Not found" }, { status: 404 }));
  }
  if (!(await hasCycleAccess(auth.user.sub, sessionForAuth.applicationCycleId))) {
    return withAuth(auth, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const gate = await requireApiSignedOrForbidden(
    auth.user.sub,
    sessionForAuth.applicationCycleId,
  );
  if (gate) return gate;

  const body = await parseJson(request, MoveSchema);
  if (body instanceof Response) return withAuth(auth, body);
  const { cardId, toColumn, position } = body;

  if (!cardId || typeof cardId !== "string") {
    return withAuth(auth, Response.json({ error: "cardId is required" }, { status: 400 }));
  }
  if (!toColumn || typeof toColumn !== "string") {
    return withAuth(auth, Response.json({ error: "toColumn is required" }, { status: 400 }));
  }

  try {
    const updated = await prisma.$transaction(
      async (tx) => {
        const session = await tx.delibsSession.findUnique({
          where: { id: params.id },
        });
        if (!session) {
          throw new Error("__NOT_FOUND__");
        }
        if (session.status === "Closed") {
          throw new Error("__CLOSED__");
        }

        const validColumns: readonly string[] =
          session.type === "Initial" ? INITIAL_COLUMNS : FINAL_COLUMNS;
        if (!validColumns.includes(toColumn)) {
          throw new Error("__INVALID_COLUMN__");
        }

        const current = (session.columnOrder ?? {}) as Record<string, string[]>;
        const next: Record<string, string[]> = {};
        for (const col of validColumns) {
          next[col] = (current[col] ?? []).filter((id) => id !== cardId);
        }

        const target = next[toColumn];
        if (
          typeof position === "number" &&
          position >= 0 &&
          position <= target.length
        ) {
          target.splice(position, 0, cardId);
        } else {
          target.push(cardId);
        }

        const result = await tx.delibsSession.update({
          where: { id: params.id },
          data: { columnOrder: next },
        });
        return result;
      },
      { isolationLevel: "Serializable" },
    );

    return withAuth(auth, Response.json(updated));
  } catch (err: any) {
    if (err?.message === "__NOT_FOUND__") {
      return withAuth(auth, Response.json({ error: "Not found" }, { status: 404 }));
    }
    if (err?.message === "__CLOSED__") {
      return withAuth(auth, Response.json({ error: "Session is closed" }, { status: 409 }));
    }
    if (err?.message === "__INVALID_COLUMN__") {
      return withAuth(auth, Response.json({ error: "Invalid column" }, { status: 400 }));
    }
    throw err;
  }
}
