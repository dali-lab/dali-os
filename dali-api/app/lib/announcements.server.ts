// Shared announcement fan-out, called by the Core composer route
// (api.notifications.send) and the scheduled-announcements job. Resolves the
// composable audience (union of whole-lab / groups / individuals), validates
// an attached form is still published, and dispatches through notify() so
// per-user preferences apply.

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { resolveGroupMembers, resolveAllLabMembers } from "~/lib/groups";
import type { NotificationKind } from "~/generated/prisma/client";

export type AnnouncementInput = {
  createdByUserId: string;
  title: string;
  body?: string | null;
  bodyHtml?: string | null;
  link?: string | null;
  kind?: NotificationKind | null;
  isTodo?: boolean | null;
  dueAt?: Date | null;
  formId?: string | null;
  // Also deliver the announcement email to each recipient's Dartmouth address
  // (composer toggle). Email channel only — in-app/Slack are unaffected.
  ccDartmouth?: boolean | null;
  allMembers: boolean;
  groupIds: string[];
  userIds: string[];
};

export type AnnouncementResult =
  | { ok: true; count: number }
  | { ok: false; error: string; status: number };

export async function sendAnnouncement(input: AnnouncementInput): Promise<AnnouncementResult> {
  const { groupIds, userIds } = input;
  if (!input.allMembers && groupIds.length === 0 && userIds.length === 0) {
    return { ok: false, error: "Pick an audience", status: 400 };
  }

  // Union of every selected source.
  const collected: string[] = [...userIds];
  if (input.allMembers) {
    collected.push(...(await resolveAllLabMembers()));
  }
  for (const gid of groupIds) {
    collected.push(...(await resolveGroupMembers(gid)));
  }
  // Provenance hint only (single column): keep it when exactly one group and
  // nothing else drove the send; otherwise it's a mixed audience.
  const sourceGroupId =
    groupIds.length === 1 && !input.allMembers && userIds.length === 0 ? groupIds[0] : null;

  const recipientIds = Array.from(new Set(collected.filter(Boolean)));
  if (recipientIds.length === 0) {
    return { ok: false, error: "No recipients resolved", status: 400 };
  }

  // An attached form must be fillable at send time (possibly by people
  // outside dali-api), so re-validate published here — the composer also
  // checks at schedule time, but a form can be unpublished in between.
  let formLink: string | null = null;
  if (input.formId) {
    const form = await prisma.form.findUnique({
      where: { id: input.formId },
      select: { id: true, published: true, publicToken: true },
    });
    if (!form) return { ok: false, error: "Attached form not found", status: 404 };
    if (!form.published) {
      return {
        ok: false,
        error: "Attach a published form (publish it first).",
        status: 400,
      };
    }
    // Give the email/Slack channels a way to reach the form — the same authed
    // fill route the in-app Task links to (app/lib/tasks.ts). In-app derives
    // its own link from formId, so this only affects the outbound channels.
    if (form.publicToken) formLink = `/forms/fill/${form.publicToken}`;
  }

  const result = await notify({
    eventType: "announcement",
    createdByUserId: input.createdByUserId,
    message: {
      kind: input.kind ?? "General",
      title: input.title,
      body: input.body ?? null,
      bodyHtml: input.bodyHtml ?? null,
      link: input.link ?? formLink,
      linkLabel: !input.link && formLink ? "Open the form" : null,
      sourceGroupId,
      isTodo: input.isTodo ?? false,
      dueAt: input.dueAt ?? null,
      formId: input.formId ?? null,
      ccDartmouth: input.ccDartmouth ?? false,
    },
    recipients: recipientIds.map((userId) => ({ userId })),
  });

  return { ok: true, count: result.inApp };
}
