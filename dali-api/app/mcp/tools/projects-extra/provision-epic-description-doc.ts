import { randomUUID } from "node:crypto";
import { prisma } from "~/lib/db.server";
import { canEditProject } from "../access";
import { McpNotFoundError, McpForbiddenError } from "./errors";
import { replaceCollabDocContent } from "~/collab/write";
import { plainTextToBlocks } from "~/collab/blocknote-server";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";

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
