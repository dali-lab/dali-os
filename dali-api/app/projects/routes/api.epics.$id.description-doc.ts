import type { Route } from "./+types/api.epics.$id.description-doc";
import { randomUUID } from "node:crypto";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { replaceCollabDocContent } from "~/collab/write";
import { plainTextToBlocks } from "~/collab/blocknote-server";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";

// POST /api/epics/:id/description-doc
//
// Lazily provision the collab-doc room name for an Epic's rich description.
// Returns `{ descriptionDocId }`. Idempotent: if the column is already set,
// the stored value is returned untouched. If null, a new opaque id is
// generated, written, and returned.
//
// Called by the epic detail modal when it first opens so the collab
// DocEditor has a stable room name to bind to. The id is opaque —
// not a Page row, no migration to a richer model. authorizeCollabDoc has an
// `epic` branch that looks the column up here.
//
// Also seeds the collab doc from the legacy plain-text `description` column
// the first time: epics created via MCP (create_epic) or before the collab
// switch carry their text there with an empty doc, which otherwise showed the
// plain text stacked above an empty editor in the modal. Only seeds when the
// doc has no persisted state yet, so edited content is never clobbered.
//
// Same edit gate as the rest of the epic API (isCore === Admin || Core).

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(
      request,
      Response.json({ error: "Method not allowed" }, { status: 405 }),
    );
  }
  const epicId = params.id!;
  const epic = await prisma.epic.findUnique({
    where: { id: epicId },
    select: { descriptionDocId: true, projectId: true, description: true },
  });
  if (!epic) {
    return withCors(request, Response.json({ error: "Epic not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, epic.projectId);
  if (!gate.ok) return gate.response;

  // Reuse the stored room name if present, else mint one. Use crypto.randomUUID
  // rather than Prisma's @default(cuid()) since this column is a plain string
  // with no default. The room name is opaque to the editor; collisions are
  // negligible at UUID width.
  let descriptionDocId = epic.descriptionDocId;
  if (!descriptionDocId) {
    descriptionDocId = randomUUID();
    await prisma.epic.update({
      where: { id: epicId },
      data: { descriptionDocId },
    });
  }

  // Move any legacy plain-text description into the doc, once — but only while
  // the doc has no real content, so we never overwrite text someone has since
  // edited. A CollabDocument row is not a good "already migrated" signal:
  // merely opening the editor writes an empty paragraph, creating a row with no
  // text. So read the body and seed only when it's actually blank — otherwise
  // the hover card (which reads the column) shows text the empty editor doesn't.
  if (epic.description?.trim()) {
    const docName = `epic:${descriptionDocId}:description`;
    const existingText = blocksToPlainText(await readDocAsBlocks(docName)).trim();
    if (!existingText) {
      await replaceCollabDocContent(
        docName,
        plainTextToBlocks(epic.description),
        gate.auth.user.sub,
      );
    }
  }

  return withCors(request, Response.json({ descriptionDocId }));
}
