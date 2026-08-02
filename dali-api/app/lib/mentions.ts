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

type RichTextNode = {
  type?: string;
  // Legacy ProseMirror mentions carry the user id in attrs.id …
  attrs?: Record<string, unknown>;
  // … BlockNote mentions carry it in props.id (same key, 1:1 port).
  props?: Record<string, unknown>;
  content?: RichTextNode[];
  children?: RichTextNode[];
};

/** Walk a rich-text body for mention nodes and collect the user ids they
 * carry. Handles both shapes the JSON columns can hold: legacy ProseMirror
 * docs ({type:"doc"} tree, id in attrs.id) and BlockNote block arrays
 * (content + children arrays, id in props.id). */
export function extractMentionUserIds(json: unknown): string[] {
  const ids = new Set<string>();
  const walk = (node: RichTextNode | null | undefined) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "mention") {
      const id = node.attrs?.id ?? node.props?.id;
      if (typeof id === "string" && id) ids.add(id);
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  if (Array.isArray(json)) (json as RichTextNode[]).forEach(walk);
  else walk(json as RichTextNode);
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
