// Flag-aware entry point for the shared email layout. The only place that
// decides between the pre-layout fragment and the laid-out document, so no
// caller has to know the flag exists.

import { getFrontendUrl } from "~/lib/app-env";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { htmlToPlainText } from "~/lib/email";

import { renderEmailDocument, renderLegacyCard } from "~/email/lib/layout";
import {
  renderMemberEmailDocument,
  renderMemberEmailFragment,
  type MemberEmailArgs,
} from "~/email/lib/member-email";
import type { AuthEmailParts } from "~/email/lib/auth-email";

// Evaluated for everyone rather than per-user: email goes out from jobs with no
// request, and a layout that varied by recipient would make a reported rendering
// bug impossible to reproduce.
export function emailLayoutEnabled(): Promise<boolean> {
  return isFeatureEnabledForEveryone("email-layout");
}

export type RenderedEmail = { html: string; text: string };

// The generic member email behind notify(). Returns both parts; callers pass
// them straight to enqueueOutbound as bodyHtml/bodyText.
export async function renderMemberEmail(
  args: Omit<MemberEmailArgs, "baseUrl"> & { baseUrl?: string },
): Promise<RenderedEmail> {
  const full: MemberEmailArgs = { ...args, baseUrl: args.baseUrl ?? getFrontendUrl() };
  if (await emailLayoutEnabled()) return renderMemberEmailDocument(full);
  const html = renderMemberEmailFragment(full);
  // Flag-off still gains the text part: it needs no layout, and shipping
  // HTML-only mail is the thing MIME_HTML_ONLY penalizes.
  return { html, text: htmlToPlainText(html) };
}

// Feature-owned mail that composes its own body: auth, partners, signing,
// education's portal-student emails. The caller hands over the body and the
// pieces around it; the flag picks the frame.
//
// Only the frame is gated. Where these rewrites also fixed content — escaping an
// interpolated name, deriving an expiry sentence from its TTL constant, labelling
// an OTP by type — that applies on both paths, because it was wrong rather than
// merely unstyled.
export async function renderFramedEmail(
  parts: AuthEmailParts,
  opts?: { footer?: "notifications" | "transactional" | "none" },
): Promise<RenderedEmail & { subject: string }> {
  const baseUrl = getFrontendUrl();
  const html = (await emailLayoutEnabled())
    ? renderEmailDocument({
        bodyHtml: parts.bodyHtml,
        preheader: parts.preheader,
        cta: parts.cta ?? null,
        footer: opts?.footer ?? "transactional",
        baseUrl,
      })
    : renderLegacyCard({ bodyHtml: parts.bodyHtml, cta: parts.cta ?? null, baseUrl });
  return { subject: parts.subject, html, text: parts.text };
}

// Auth mail (sign-in link, sign-in code, email verification). Always
// transactional: a sign-in code is not something anyone can switch off, so
// offering a notification-settings link would misrepresent it.
export function renderAuthEmail(
  parts: AuthEmailParts,
): Promise<RenderedEmail & { subject: string }> {
  return renderFramedEmail(parts, { footer: "transactional" });
}
