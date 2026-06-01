// MCP resource `dali://forms/pending` — published forms attached to one of the
// caller's unread notifications. Mirrors the form-handling in `listOpenTasks`
// (`~/lib/tasks.ts`): a notification with `form.published && form.publicToken`
// links the recipient to the authed fill page, which is what marks the
// notification read on submit. We expose the title, dueAt, and the fill URL.
// Requires the `mcp:read` scope.

import { prisma } from "~/lib/db";

export const FORMS_PENDING_RESOURCE = {
  uri: "dali://forms/pending",
  name: "Pending forms",
  description:
    "Published forms the authenticated member has been asked to fill (still unread/unsubmitted), with their fill URLs. JSON.",
  mimeType: "application/json",
  requiredScope: "mcp:read" as const,
};

type PendingFormOut = {
  notificationId: string;
  title: string;
  body: string | null;
  dueAt: string | null;
  formId: string;
  formName: string;
  fillUrl: string;
  postedAt: string;
};

export async function readFormsPendingResource(callerId: string) {
  const rows = await prisma.notification.findMany({
    where: {
      recipientUserId: callerId,
      readAt: null,
      formId: { not: null },
      form: { published: true, publicToken: { not: null } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      body: true,
      dueAt: true,
      createdAt: true,
      formId: true,
      form: { select: { name: true, publicToken: true } },
    },
  });

  const items: PendingFormOut[] = rows
    .filter((r) => r.form?.publicToken && r.formId)
    .map((r) => ({
      notificationId: r.id,
      title: r.title,
      body: r.body,
      dueAt: r.dueAt?.toISOString() ?? null,
      formId: r.formId!,
      formName: r.form!.name,
      fillUrl: `/forms/fill/${r.form!.publicToken}`,
      postedAt: r.createdAt.toISOString(),
    }));

  return JSON.stringify({ pendingForms: items }, null, 2);
}
