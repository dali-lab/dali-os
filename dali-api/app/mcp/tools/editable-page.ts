import { prisma } from "~/lib/db.server";
import { PAGE_ACCESS_SELECT, getPageAccess } from "~/lib/pageAccess.server";

export const MAX_MARKDOWN_LENGTH = 300_000;

export class EditablePageError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "EditablePageError";
  }
}

export async function loadEditablePage(callerId: string, pageId: string) {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: {
      ...PAGE_ACCESS_SELECT,
      kind: true,
      contentDocId: true,
    },
  });
  if (!page) throw new EditablePageError("Page not found", 404);
  if (
    page.workspaceType !== "Project" &&
    page.workspaceType !== "Lab" &&
    page.workspaceType !== "Member"
  ) {
    throw new EditablePageError("Page workspace type does not support content editing", 400);
  }
  if (page.kind !== "FreeForm") {
    throw new EditablePageError(`${page.kind} pages have no editable body`, 400);
  }
  if (page.archivedAt) {
    throw new EditablePageError("Page is in the trash. Restore it first with manage_drive_trash.", 400);
  }
  const access = await getPageAccess(callerId, page);
  if (!access.canEdit) throw new EditablePageError("Forbidden", 403);
  return page;
}
