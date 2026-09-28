import type { Route } from "./+types/api.email.attachment";
import { requireAuth } from "~/lib/auth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { findReadableAccount } from "~/email/lib/access.server";
import { getAttachment, getMailboxToken, getThread, MailboxError } from "~/email/lib/gmail-mailbox.server";

// GET /api/email/attachment?account=&thread=&message=&attachment=&name=
// Streams one Gmail attachment. Gated to inboxes the viewer can read; the bytes
// are fetched with the viewer's own Gmail token, so Gmail itself scopes the
// fetch to that mailbox. The filename/type come from the verified thread part,
// never the URL, and the response is forced to download (never rendered inline).
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;
  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("email", userId, roles, request))) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const accountId = url.searchParams.get("account") ?? "";
  const threadId = url.searchParams.get("thread") ?? "";
  const messageId = url.searchParams.get("message") ?? "";
  const attachmentId = url.searchParams.get("attachment") ?? "";
  if (!accountId || !threadId || !messageId || !attachmentId) {
    return new Response("Bad request", { status: 400 });
  }

  const account = await findReadableAccount(userId, accountId, request);
  if (!account) return new Response("Not found", { status: 404 });

  try {
    const token = await getMailboxToken(account);
    // Confirm the attachment belongs to a part of this thread in this mailbox,
    // and take the filename/type from there.
    const messages = await getThread(token, threadId);
    const part = messages.find((m) => m.id === messageId)?.attachments.find((a) => a.attachmentId === attachmentId);
    if (!part) return new Response("Not found", { status: 404 });

    const bytes = await getAttachment(token, messageId, attachmentId);
    // Strip control chars, quotes and backslash so the filename can't break out
    // of the Content-Disposition header.
    const clean = part.filename.replace(/[\p{Cc}"\\]/gu, "");
    const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
    const star = /^[\x20-\x7e]*$/.test(clean)
      ? ""
      : `; filename*=UTF-8''${encodeURIComponent(clean).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
    // Wrap in a fresh Uint8Array<ArrayBuffer>: Node's Buffer<ArrayBufferLike>
    // isn't assignable to the DOM BodyInit type.
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": (part.mimeType || "application/octet-stream").replace(/[\r\n]/g, ""),
        "Content-Disposition": `attachment; filename="${ascii}"${star}`,
        "Content-Length": String(bytes.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof MailboxError) return new Response("Couldn't load attachment", { status: 502 });
    throw err;
  }
}
