import { prisma } from "~/lib/db.server";
import { canEditPageMetadata, isRenamableWorkspace, resolveRenameTitle } from "~/drive/lib/page-rename.server";
import { pageDepth, MAX_PAGE_DEPTH, isAncestorOf } from "~/lib/pages.server";
import { announceAgent, pagePresenceRoom } from "~/collab/agent-presence.server";

type Input = {
  pageId: string;
  title?: string;
  iconEmoji?: string;
  parentPageId?: string;
};

export class UpdatePageError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "UpdatePageError";
  }
}

export async function runUpdatePage(callerId: string, input: Input) {
  const page = await prisma.page.findUnique({
    where: { id: input.pageId },
    select: {
      id: true,
      workspaceType: true,
      workspaceId: true,
      parentPageId: true,
      kind: true,
      archivedAt: true,
    },
  });
  if (!page || !isRenamableWorkspace(page)) {
    throw new UpdatePageError("Page not found", 404);
  }
  const isProject = page.workspaceType === "Project";
  if (!(await canEditPageMetadata(callerId, page))) {
    throw isProject ? new UpdatePageError("Forbidden", 403) : new UpdatePageError("Page not found", 404);
  }
  if (!isProject && input.parentPageId !== undefined) {
    throw new UpdatePageError("Only project pages can be moved here", 400);
  }

  const data: {
    title?: string;
    iconEmoji?: string | null;
    parentPageId?: string | null;
    position?: number;
    lastEditedById?: string;
  } = {};

  if (input.title !== undefined) {
    data.title = await resolveRenameTitle(page, input.title, callerId);
    data.lastEditedById = callerId;
  }

  if (input.iconEmoji !== undefined) {
    data.iconEmoji = input.iconEmoji === "" ? null : input.iconEmoji;
  }

  if (input.parentPageId !== undefined && input.parentPageId !== (page.parentPageId ?? "")) {
    const newParentId = input.parentPageId === "" ? null : input.parentPageId;
    if (newParentId) {
      if (newParentId === page.id) {
        throw new UpdatePageError("A page can't be moved into itself", 400);
      }
      const parent = await prisma.page.findUnique({
        where: { id: newParentId },
        select: {
          workspaceType: true,
          workspaceId: true,
          parentPageId: true,
          kind: true,
          archivedAt: true,
        },
      });
      if (
        !parent ||
        parent.archivedAt !== null ||
        parent.workspaceType !== "Project" ||
        parent.workspaceId !== page.workspaceId
      ) {
        throw new UpdatePageError("Parent folder not found", 404);
      }
      if (parent.kind !== "Folder") {
        throw new UpdatePageError("Pages can only nest inside a folder", 400);
      }
      const depth = await pageDepth(newParentId);
      if (depth < 0 || depth >= MAX_PAGE_DEPTH) {
        throw new UpdatePageError("Folder is too deeply nested", 400);
      }
      // Cycle guard: a folder can't be moved into its own subtree.
      if (page.kind === "Folder" && (await isAncestorOf(page.id, newParentId))) {
        throw new UpdatePageError("A folder can't be moved into its own contents", 400);
      }
    }
    const last = await prisma.page.findFirst({
      where: {
        workspaceType: "Project",
        workspaceId: page.workspaceId,
        parentPageId: newParentId,
      },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    data.parentPageId = newParentId;
    data.position = last ? last.position + 1 : 0;
  }

  if (Object.keys(data).length === 0) {
    throw new UpdatePageError("Nothing to update", 400);
  }

  const updated = await prisma.page.update({
    where: { id: page.id },
    data,
    select: { id: true, title: true, iconEmoji: true, parentPageId: true },
  });
  void announceAgent({ action: "editing", presenceRoom: pagePresenceRoom(page.id) });

  return {
    id: updated.id,
    title: updated.title,
    iconEmoji: updated.iconEmoji,
    parentPageId: updated.parentPageId,
  };
}
