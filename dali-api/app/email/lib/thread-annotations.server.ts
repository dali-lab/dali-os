import { prisma } from "~/lib/db.server";
import { getThreadLink } from "~/email/lib/mail-index.server";

export async function loadThreadAnnotations(account: { id: string; kind: string }, threadId: string) {
  const linkEnabled = account.kind === "Shared";
  const [comments, link] = await Promise.all([
    prisma.mailComment.findMany({
      where: { accountId: account.id, threadId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { id: true, firstName: true, lastName: true, photoUrl: true } } },
    }),
    linkEnabled ? getThreadLink(account.id, threadId) : null,
  ]);
  let linkedUser: { userId: string; firstName: string; lastName: string; photoUrl: string | null; source: "Auto" | "Manual" } | null =
    null;
  if (link && "userId" in link) {
    const user = await prisma.user.findUnique({
      where: { id: link.userId },
      select: { firstName: true, lastName: true, photoUrl: true },
    });
    if (user) linkedUser = { userId: link.userId, ...user, source: link.source };
  }
  return { comments, linkedUser, linkEnabled };
}
