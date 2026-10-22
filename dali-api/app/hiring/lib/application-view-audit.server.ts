import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";

// Every save revalidates the reviewer page loader, so without a window one
// reviewing session would write a view row per autosave.
export const APPLICATION_VIEW_WINDOW_MS = 30 * 60 * 1000;

export async function logApplicationView(args: {
  userId: string;
  applicationId: string;
  cycleId: string;
  blinded: boolean;
  request: Request;
}): Promise<void> {
  try {
    const recent = await prisma.auditLog.findFirst({
      where: {
        action: "application.view",
        userId: args.userId,
        targetId: args.applicationId,
        createdAt: { gte: new Date(Date.now() - APPLICATION_VIEW_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (recent) return;
  } catch {
    // Dedupe is best effort: an unreadable log must not hide a view.
  }
  await logAuditEvent({
    action: "application.view",
    userId: args.userId,
    targetId: args.applicationId,
    metadata: { cycleId: args.cycleId, blinded: args.blinded },
    request: args.request,
  });
}
