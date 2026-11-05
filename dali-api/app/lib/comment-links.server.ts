import { prisma } from "~/lib/db.server";
import { slideThreadHref, anchorSlideId } from "~/lib/slide-comments";

/** Where a notification about a doc comment thread should open, and the title it names. */
export async function docCommentContext(pageId: string, rootId: string, commentId: string, rootAnchor?: unknown) {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { title: true, kind: true } });
  if (page?.kind !== "Slides") {
    return { title: page?.title ?? null, link: `/documents/${pageId}?comment=${commentId}`, replyLink: `/documents/${pageId}` };
  }
  const anchor = rootAnchor ?? (await prisma.docComment.findUnique({ where: { id: rootId }, select: { anchor: true } }))?.anchor;
  const link = slideThreadHref(pageId, { slideId: anchorSlideId(anchor), threadId: rootId });
  return { title: page.title, link, replyLink: link };
}
