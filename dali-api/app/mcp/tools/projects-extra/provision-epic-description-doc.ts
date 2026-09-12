// MCP `provision_epic_description_doc` — lazily provision the collab-doc room
// name for an epic's rich description. Returns `{ descriptionDocId }`.
//
// COLLAB FLAG: this tool touches the collab pipeline (Hocuspocus / Yjs).
// It calls replaceCollabDocContent to seed legacy plain-text into the doc room
// the first time — the same behaviour as POST /api/epics/:id/description-doc.
//
// Idempotent: if descriptionDocId is already set the stored value is returned
// untouched. Seeds the collab doc from Epic.description only when the doc has
// no real content yet (prevents overwriting edits).
//
// Gate: canEditProject (Core or project member) — mirrors the web route.

import { randomUUID } from "node:crypto";
import { prisma } from "~/lib/db";
import { canEditProject } from "../access";
import { McpNotFoundError, McpForbiddenError } from "./errors";
import { replaceCollabDocContent } from "~/collab/write";
import { plainTextToBlocks } from "~/collab/blocknote-server";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";

export const PROVISION_EPIC_DESCRIPTION_DOC_TOOL = {
  name: "provision_epic_description_doc",
  description:
    "Provision (or return) the collab-doc room ID for an epic's rich description. Call this before opening the collab editor for an epic. If the epic has a plain-text description and the doc room is empty, seeds the doc from that text. Returns { descriptionDocId }. Requires Core or project-member access.",
  inputSchema: {
    type: "object" as const,
    properties: {
      epicId: { type: "string", minLength: 1 },
    },
    required: ["epicId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { epicId: string };

export async function runProvisionEpicDescriptionDoc(callerId: string, input: Input) {
  const epic = await prisma.epic.findUnique({
    where: { id: input.epicId },
    select: { descriptionDocId: true, projectId: true, description: true },
  });
  if (!epic) throw new McpNotFoundError("Epic not found");

  if (!(await canEditProject(callerId, epic.projectId))) {
    throw new McpForbiddenError();
  }

  let descriptionDocId = epic.descriptionDocId;
  if (!descriptionDocId) {
    descriptionDocId = randomUUID();
    await prisma.epic.update({
      where: { id: input.epicId },
      data: { descriptionDocId },
    });
  }

  // Seed legacy plain-text into the doc once — only when the doc is empty.
  // Mirrors the web route's seeding logic exactly.
  if (epic.description?.trim()) {
    const docName = `epic:${descriptionDocId}:description`;
    const existingText = blocksToPlainText(await readDocAsBlocks(docName)).trim();
    if (!existingText) {
      await replaceCollabDocContent(
        docName,
        plainTextToBlocks(epic.description),
        callerId,
      );
    }
  }

  return { descriptionDocId };
}
