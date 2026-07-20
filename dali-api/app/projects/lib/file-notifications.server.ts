// Emitters for project-file events (file.comment, file.new_version) — the
// artifact feedback loop on task-linked uploads. Mirrors
// task-notifications.server.ts: each helper loads what it needs and dispatches
// via notify(); callers fire-and-forget so a delivery hiccup never fails the
// underlying write.

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";

const PREVIEW_MAX = 200;

function fileLink(fileId: string): string {
  return `/documents/file/${fileId}`;
}

// Everyone with a stake in a file: version uploaders, comment authors, and
// assignees of tasks the file is linked to.
async function loadFileAudience(fileId: string): Promise<{
  title: string;
  versionCount: number;
  userIds: Set<string>;
} | null> {
  const file = await prisma.projectFile.findUnique({
    where: { id: fileId },
    select: {
      title: true,
      versions: { select: { uploadedById: true } },
      comments: { select: { authorId: true } },
      taskLinks: {
        select: {
          task: { select: { assignees: { select: { userId: true } } } },
        },
      },
    },
  });
  if (!file) return null;
  const userIds = new Set<string>();
  for (const v of file.versions) userIds.add(v.uploadedById);
  for (const c of file.comments) userIds.add(c.authorId);
  for (const l of file.taskLinks) {
    for (const a of l.task.assignees) userIds.add(a.userId);
  }
  return { title: file.title, versionCount: file.versions.length, userIds };
}

// A new root comment on a file. Replies stay on collab.comment_reply (thread
// participants); this covers the previously-silent first touch — the mentor's
// feedback reaching the uploader.
export async function notifyFileComment(args: {
  fileId: string;
  authorId: string;
  body: string;
}): Promise<void> {
  const audience = await loadFileAudience(args.fileId);
  if (!audience) return;
  const recipients = [...audience.userIds].filter((id) => id !== args.authorId);
  if (recipients.length === 0) return;
  const preview =
    args.body.length > PREVIEW_MAX ? `${args.body.slice(0, PREVIEW_MAX)}…` : args.body;
  await notify({
    eventType: "file.comment",
    createdByUserId: args.authorId,
    message: {
      title: `New feedback on: ${audience.title}`,
      body: preview,
      link: fileLink(args.fileId),
    },
    recipients: recipients.map((userId) => ({ userId })),
  });
}

// A new version was uploaded. Called after the version row exists, so the
// version count already includes it ("V3 uploaded"). Closes the loop back to
// whoever gave feedback on the previous iteration.
export async function notifyFileNewVersion(args: {
  fileId: string;
  uploadedById: string;
}): Promise<void> {
  const audience = await loadFileAudience(args.fileId);
  if (!audience) return;
  const recipients = [...audience.userIds].filter((id) => id !== args.uploadedById);
  if (recipients.length === 0) return;
  await notify({
    eventType: "file.new_version",
    createdByUserId: args.uploadedById,
    message: {
      title: `V${audience.versionCount} uploaded: ${audience.title}`,
      link: fileLink(args.fileId),
    },
    recipients: recipients.map((userId) => ({ userId })),
  });
}
