// Resolve notification copy: the operator's row if they've written one, the
// registry's wording if they haven't.
//
// Read in one query per notify() call rather than per recipient — a fan-out can
// be hundreds of people and they all share the same template.

import { prisma } from "~/lib/db";
import { interpolateVars } from "~/lib/template-variables";

import {
  notificationCopyDef,
  type NotificationCopyKey,
} from "~/email/lib/notification-copy";
import { NOTIFY_KEY_PREFIX, notifyTemplateKey } from "~/email/lib/registry";

export type ResolvedCopy = { subject: string; body: string | null };

export type CopyByKey = Map<NotificationCopyKey, ResolvedCopy>;

export async function resolveNotificationCopy(
  keys: readonly NotificationCopyKey[],
): Promise<CopyByKey> {
  const out: CopyByKey = new Map();
  const wanted = [...new Set(keys)];
  if (wanted.length === 0) return out;

  const rows = await prisma.emailTemplate.findMany({
    where: { key: { in: wanted.map(notifyTemplateKey) } },
    select: { key: true, subject: true, body: true },
  });
  const edited = new Map(
    rows.map((r) => [
      r.key.slice(NOTIFY_KEY_PREFIX.length) as NotificationCopyKey,
      r,
    ]),
  );

  for (const key of wanted) {
    const def = notificationCopyDef(key);
    const row = edited.get(key);
    out.set(key, {
      subject: row?.subject ?? def.subject,
      // A template with no body (announcements) means the caller's body passes
      // through, which is what null signals to renderNotificationCopy below.
      body: row ? row.body : (def.body ?? null),
    });
  }
  return out;
}

// Apply a resolved template to one recipient's variables. Returns null for a
// field the template leaves to the caller.
export function renderNotificationCopy(
  copy: ResolvedCopy | undefined,
  vars: Record<string, string>,
): { subject: string | null; body: string | null } {
  if (!copy) return { subject: null, body: null };
  const subject = copy.subject ? interpolateVars(copy.subject, vars) : null;
  if (copy.body === null) return { subject, body: null };
  const body = interpolateVars(copy.body, vars);
  // An empty body is a template saying "there is no second line", not a missing
  // value — collapse it to null so the row and the email both omit it.
  return { subject, body: body.trim() ? body : null };
}
