import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";

// @-mention parsing + notification, shared by page-doc bodies (rich text with
// mention nodes) and FAQ comments (plain text with "@handle" tokens). There is
// no user @-mention flow elsewhere in the app yet; this is the first one.

/** Pull "@handle" tokens out of plain text (comment bodies). Returns the bare,
 * lowercased handles, deduped. */
export function extractHandlesFromText(text: string): string[] {
  const out = new Set<string>();
  const re = /@([a-z0-9_]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1]!.toLowerCase());
  return [...out];
}

type ProseMirrorNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
};

/** Walk a ProseMirror doc for mention nodes and collect the user ids they
 * carry (the mention extension stores the tagged user's id in attrs.id). */
export function extractMentionUserIds(json: unknown): string[] {
  const ids = new Set<string>();
  const walk = (node: ProseMirrorNode | null | undefined) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "mention" && typeof node.attrs?.id === "string") {
      ids.add(node.attrs.id);
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(json as ProseMirrorNode);
  return [...ids];
}

/** Build a safe app-relative deep link that opens a page's docs modal. Rejects
 * absolute / protocol-relative paths so a notification link stays on-origin. */
export function pageDocLink(path: string | undefined | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/";
  return path.includes("?") ? `${path}&doc=1` : `${path}?doc=1`;
}

/** Resolve bare handles to the user ids that own them. Unknown handles drop. */
export async function resolveHandles(handles: string[]): Promise<string[]> {
  if (handles.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { handle: { in: handles.map((h) => h.toLowerCase()) } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Notify a set of mentioned users, excluding the actor and de-duping. `link`
 * is the app-relative path the notification should open (the page the mention
 * happened on, typically with ?doc=1 so the guide modal auto-opens). */
export async function notifyMentions(args: {
  recipientUserIds: string[];
  actorId: string;
  link: string;
  title: string;
  preview: string;
}): Promise<void> {
  const recipients = [...new Set(args.recipientUserIds)].filter(
    (id) => id !== args.actorId,
  );
  if (recipients.length === 0) return;
  await notify({
    eventType: "pagedoc.mention",
    createdByUserId: args.actorId,
    message: {
      title: args.title,
      body: args.preview.length > 200 ? `${args.preview.slice(0, 200)}…` : args.preview,
      link: args.link,
    },
    recipients: recipients.map((userId) => ({ userId })),
  });
}
