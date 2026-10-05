import { redirect } from "react-router";
import { prisma } from "~/lib/db";

// "Anyone with the link" documents render the same shell-free read-only view
// to every visitor who has no member access: signed out, applicant, partner,
// or a Dartmouth account with no DALIMember row. The copied link is the plain
// /documents/:pageId URL, so the gates that would otherwise bounce such a
// visitor (login, /portal, /partner) fall through here first.

export function isPublicDoc(page: {
  linkAccess: string | null;
  archivedAt: Date | null;
}): boolean {
  return page.archivedAt === null && page.linkAccess === "Public";
}

export function publicDocPath(pageId: string): string {
  return `/documents/${pageId}/public`;
}

export async function publicDocRedirectForPath(pathname: string): Promise<Response | null> {
  const match = pathname.match(/^\/documents\/([^/]+)$/);
  if (!match) return null;
  const page = await prisma.page.findUnique({
    where: { id: match[1] },
    select: { linkAccess: true, archivedAt: true },
  });
  return page && isPublicDoc(page) ? redirect(publicDocPath(match[1])) : null;
}
