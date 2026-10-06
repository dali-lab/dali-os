import type { Route } from "./+types/api.email.attachment";
import { requireAuth } from "~/lib/auth";
import { findReadableAccount } from "~/email/lib/access.server";
import { getAttachment, getMailboxToken, getThread, MailboxError } from "~/email/lib/gmail-mailbox.server";

// GET /api/email/attachment?account=&thread=&message=&index=
// Streams one Gmail attachment. Gated to inboxes the viewer can read; the bytes
// are fetched with the viewer's own Gmail token, so Gmail itself scopes the
// fetch to that mailbox. The attachment is addressed by its position in the
// message, so Gmail's opaque (and very long) attachment id is resolved
// server-side and never rides in the URL. The response is forced to download.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;

  const url = new URL(request.url);
  const accountId = url.searchParams.get("account") ?? "";
  const threadId = url.searchParams.get("thread") ?? "";
  const messageId = url.searchParams.get("message") ?? "";
  const index = Number(url.searchParams.get("index"));
  if (!accountId || !threadId || !messageId || !Number.isInteger(index) || index < 0) {
    return new Response("Bad request", { status: 400 });
  }

  const account = await findReadableAccount(userId, accountId, request);
  if (!account) return new Response("Not found", { status: 404 });

  try {
    const token = await getMailboxToken(account);
    const message = (await getThread(token, threadId)).find((m) => m.id === messageId);
    const att = message?.attachments[index];
    if (!att?.attachmentId) return new Response("Not found", { status: 404 });

    const bytes = await getAttachment(token, messageId, att.attachmentId);
    if (bytes.length === 0) return new Response("Attachment was empty", { status: 502 });

    // Strip control chars, quotes and backslash so the filename can't break out
    // of the Content-Disposition header; RFC 5987 carries any non-ASCII name.
    const clean = att.filename.replace(/[\p{Cc}"\\]/gu, "");
    const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
    const star = /^[\x20-\x7e]*$/.test(clean)
      ? ""
      : `; filename*=UTF-8''${encodeURIComponent(clean).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
    // Wrap in a fresh Uint8Array<ArrayBuffer>: Node's Buffer<ArrayBufferLike>
    // isn't assignable to the DOM BodyInit type. Content-Length is left to the
    // runtime — setting it by hand breaks the download under the server adapter.
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": (att.mimeType || "application/octet-stream").replace(/[\r\n]/g, ""),
        "Content-Disposition": `attachment; filename="${ascii}"${star}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof MailboxError) return new Response("Couldn't load attachment", { status: 502 });
    throw err;
  }
}
