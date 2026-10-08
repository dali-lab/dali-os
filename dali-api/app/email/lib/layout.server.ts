// Entry point for the shared email layout: every outbound email is rendered as
// the laid-out document, with a plain-text part alongside.

import { getFrontendUrl } from "~/lib/app-env";

import { renderEmailDocument } from "~/email/lib/layout";
import { renderMemberEmailDocument, type MemberEmailArgs } from "~/email/lib/member-email";
import type { AuthEmailParts } from "~/email/lib/auth-email";

export type RenderedEmail = { html: string; text: string };

// The generic member email behind notify(). Returns both parts; callers pass
// them straight to enqueueOutbound as bodyHtml/bodyText.
export function renderMemberEmail(
  args: Omit<MemberEmailArgs, "baseUrl"> & { baseUrl?: string },
): RenderedEmail {
  return renderMemberEmailDocument({ ...args, baseUrl: args.baseUrl ?? getFrontendUrl() });
}

// Feature-owned mail that composes its own body: auth, partners, signing,
// education's portal-student emails. The caller hands over the body and the
// pieces around it; the layout supplies the frame.
export function renderFramedEmail(
  parts: AuthEmailParts,
  opts?: { footer?: "notifications" | "transactional" | "none" },
): RenderedEmail & { subject: string } {
  const html = renderEmailDocument({
    bodyHtml: parts.bodyHtml,
    preheader: parts.preheader,
    cta: parts.cta ?? null,
    footer: opts?.footer ?? "transactional",
    baseUrl: getFrontendUrl(),
  });
  return { subject: parts.subject, html, text: parts.text };
}

// Auth mail (sign-in link, sign-in code, email verification). Always
// transactional: a sign-in code is not something anyone can switch off, so
// offering a notification-settings link would misrepresent it.
export function renderAuthEmail(parts: AuthEmailParts): RenderedEmail & { subject: string } {
  return renderFramedEmail(parts, { footer: "transactional" });
}
