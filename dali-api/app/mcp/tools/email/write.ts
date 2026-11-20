import {
  addMailComment,
  changeThreadLabels,
  deleteMailComment,
  findVisibleDraft,
  upsertDraft,
} from "~/email/lib/email.server";
import { getMailboxToken, listLabels } from "~/email/lib/gmail-mailbox.server";
import type { McpCtx } from "../../registry";
import { McpInvalidError, McpNotFoundError, requireForAction } from "../../errors";
import { mcpMailAccount, withGmail } from "./shared";

const REFUSED_ADD = new Set(["SPAM", "TRASH"]);
const REFUSED_REMOVE = new Set(["SENT", "DRAFT"]);

export const LABEL_MAIL_THREAD_DEF = {
  name: "label_mail_thread",
  description:
    "Add or remove Gmail labels on a thread, by label name or id (names are matched case-insensitively; see list_mail_labels). Labels are never created. To archive a thread remove INBOX, to mark it unread add UNREAD, to mark it read remove UNREAD. Adding SPAM or TRASH and removing SENT or DRAFT are refused. Pass at least one of add or remove.",
  inputSchema: {
    type: "object" as const,
    properties: {
      accountId: { type: "string", minLength: 1 },
      threadId: { type: "string", minLength: 1 },
      add: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 20 },
      remove: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 20 },
    },
    required: ["accountId", "threadId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

function resolveLabels(requested: string[], labels: { id: string; name: string }[]) {
  const resolved: { id: string; name: string }[] = [];
  for (const raw of requested) {
    const want = raw.trim().toLowerCase();
    const hit =
      labels.find((l) => l.id.toLowerCase() === want) ?? labels.find((l) => l.name.toLowerCase() === want);
    if (!hit) {
      const close = labels.filter((l) => l.name.toLowerCase().includes(want) || want.includes(l.name.toLowerCase()));
      const hint = close.length > 0 ? ` Did you mean: ${close.slice(0, 5).map((l) => l.name).join(", ")}?` : "";
      throw new McpInvalidError(`No label named "${raw}".${hint} Nothing was changed.`);
    }
    if (!resolved.some((r) => r.id === hit.id)) resolved.push({ id: hit.id, name: hit.name });
  }
  return resolved;
}

export async function runLabelMailThread(ctx: McpCtx, args: Record<string, unknown>) {
  const add = (args.add as string[] | undefined) ?? [];
  const remove = (args.remove as string[] | undefined) ?? [];
  if (add.length === 0 && remove.length === 0) throw new McpInvalidError("Pass at least one label in add or remove.");
  const account = await mcpMailAccount(ctx, args.accountId);
  const threadId = args.threadId as string;
  return withGmail(async () => {
    const labels = await listLabels(await getMailboxToken(account));
    const toAdd = resolveLabels(add, labels);
    const toRemove = resolveLabels(remove, labels);
    const badAdd = toAdd.find((l) => REFUSED_ADD.has(l.id));
    if (badAdd) throw new McpInvalidError(`Adding ${badAdd.id} isn't allowed. Nothing was changed.`);
    const badRemove = toRemove.find((l) => REFUSED_REMOVE.has(l.id));
    if (badRemove) throw new McpInvalidError(`Removing ${badRemove.id} isn't allowed. Nothing was changed.`);
    if (toAdd.some((a) => toRemove.some((r) => r.id === a.id))) {
      throw new McpInvalidError("A label can't be in both add and remove. Nothing was changed.");
    }
    await changeThreadLabels(
      account,
      threadId,
      { add: toAdd.map((l) => l.id), remove: toRemove.map((l) => l.id) },
      ctx.user.id,
    );
    return { ok: true, added: toAdd.map((l) => l.name), removed: toRemove.map((l) => l.name) };
  });
}

export const COMMENT_ON_MAIL_THREAD_DEF = {
  name: "comment_on_mail_thread",
  description:
    "Leave or delete an internal comment on a mail thread. Comments are seen only by people who can open the inbox, never by the sender. action 'create' needs accountId, threadId and body (up to 5000 characters; @handle mentions notify teammates who can open the inbox). action 'delete' needs accountId and commentId and removes only your own comment.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: { type: "string", enum: ["create", "delete"] },
      accountId: { type: "string", minLength: 1 },
      threadId: { type: "string", minLength: 1 },
      body: { type: "string" },
      commentId: { type: "string", minLength: 1 },
    },
    required: ["action", "accountId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runCommentOnMailThread(ctx: McpCtx, args: Record<string, unknown>) {
  const action = args.action as string;
  requireForAction(action, args, { create: ["threadId", "body"], delete: ["commentId"] });
  const account = await mcpMailAccount(ctx, args.accountId);
  if (action === "delete") {
    const count = await deleteMailComment(args.commentId as string, ctx.user.id, account.id);
    return { ok: true, deleted: count > 0 };
  }
  const body = (args.body as string).trim();
  if (!body) throw new McpInvalidError("Write a comment first.");
  const comment = await addMailComment({
    account,
    threadId: args.threadId as string,
    userId: ctx.user.id,
    body,
    request: ctx.request,
  });
  return { ok: true, commentId: comment.id };
}

export const DRAFT_MAIL_DEF = {
  name: "draft_mail",
  description:
    "Save an email draft in an inbox for a person to review and send from the Email tab. This never sends. Pass threadId to make it a reply, or draftId to update a draft you can see (fields you leave out keep their value). Returns draftId and the Email tab URL to open it. shared makes the draft visible to everyone who can open the inbox.",
  inputSchema: {
    type: "object" as const,
    properties: {
      accountId: { type: "string", minLength: 1 },
      threadId: { type: "string", minLength: 1 },
      draftId: { type: "string", minLength: 1 },
      to: { type: "string", minLength: 1 },
      cc: { type: "string" },
      bcc: { type: "string" },
      subject: { type: "string" },
      body: { type: "string" },
      shared: { type: "boolean" },
    },
    required: ["accountId", "to", "body"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

export async function runDraftMail(ctx: McpCtx, args: Record<string, unknown>) {
  const account = await mcpMailAccount(ctx, args.accountId);
  const draftId = args.draftId as string | undefined;
  const existing = draftId ? await findVisibleDraft(draftId, account.id, ctx.user.id) : null;
  if (draftId && !existing) throw new McpNotFoundError("Draft not found");
  const str = (key: string, fallback: string | undefined) => (args[key] as string | undefined) ?? fallback ?? "";
  const draft = await upsertDraft(
    {
      draftId,
      threadId: (args.threadId as string | undefined) ?? existing?.threadId ?? null,
      to: (args.to as string).trim(),
      cc: str("cc", existing?.cc).trim(),
      bcc: str("bcc", existing?.bcc).trim(),
      subject: str("subject", existing?.subject).trim(),
      body: args.body as string,
      shared: (args.shared as boolean | undefined) ?? existing?.shared ?? false,
    },
    account.id,
    ctx.user.id,
  );
  const origin = new URL(ctx.request.url).origin;
  return { draftId: draft.id, url: `${origin}/email?view=drafts&inbox=${encodeURIComponent(account.id)}` };
}
