// Composition for the generic member-facing email that notify() sends: a
// greeting, an optional title heading, a body, an optional call to action, and a
// footer. Two renderers over the same inputs — the pre-layout fragment and the
// laid-out document — so the `email-layout` flag can pick between them and the
// two can be diffed in a test.
//
// A leaf module: pure, no prisma, no flag lookup. layout.server.ts adds the
// flag; keeping that out of here is what stops a cycle with notify.server.ts.

import { bodyToHtml, sanitizeRichEmailHtml, htmlToPlainText } from "~/lib/email";

import { renderEmailDocument, escapeAttr, type EmailFooter } from "~/email/lib/layout";

export type MemberEmailArgs = {
  firstName: string;
  title: string;
  body?: string | null;
  bodyHtml?: string | null;
  link?: string | null;
  linkLabel?: string | null;
  // Whether to repeat the title as a heading in the body. Default true. The
  // title is always the email subject, so callers whose body already stands on
  // its own (announcements with a body) pass false to avoid duplicating it.
  titleInBody?: boolean;
  footer?: EmailFooter;
  baseUrl: string;
};

const DEFAULT_CTA_LABEL = "Open in DALI OS";

function resolveBody(args: MemberEmailArgs): string {
  if (args.bodyHtml) return sanitizeRichEmailHtml(args.bodyHtml);
  if (args.body) return bodyToHtml(args.body);
  return "";
}

// The shape this email had before the shared layout: a bare sequence of <p>
// elements with no document around them. Kept byte-for-byte so turning the
// `email-layout` flag off is a true revert, and so a test can assert the laid-out
// version carries the same links and the same words.
export function renderMemberEmailFragment(args: MemberEmailArgs): string {
  const label = args.linkLabel || DEFAULT_CTA_LABEL;
  const button = args.link
    ? `<p><a href="${args.link}" style="display:inline-block;padding:10px 16px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;">${label}</a></p>`
    : "";
  return [
    `<p>Hi ${args.firstName},</p>`,
    args.titleInBody === false ? "" : `<p><strong>${args.title}</strong></p>`,
    resolveBody(args),
    button,
    `<p style="color:#71717a;font-size:12px;">— DALI OS · <a href="${args.baseUrl}/settings/notifications" style="color:#71717a;">notification settings</a></p>`,
  ]
    .filter(Boolean)
    .join("\n");
}

// The same email inside the shared layout. Differences from the fragment, all
// deliberate: the greeting and title are escaped (they were interpolated raw),
// the CTA is a table-wrapped button that survives Outlook, the footer comes from
// the layout so every email ends the same way, and a plain-text part is produced
// alongside rather than being derived downstream.
export function renderMemberEmailDocument(args: MemberEmailArgs): {
  html: string;
  text: string;
} {
  const label = args.linkLabel || DEFAULT_CTA_LABEL;
  const bodyInner = [
    `<p style="margin:0 0 16px;">Hi ${escapeAttr(args.firstName)},</p>`,
    args.titleInBody === false
      ? ""
      : `<h1 style="margin:0 0 16px;font-size:18px;line-height:26px;font-weight:600;">${escapeAttr(args.title)}</h1>`,
    resolveBody(args),
  ]
    .filter(Boolean)
    .join("\n");

  const html = renderEmailDocument({
    bodyHtml: bodyInner,
    // The title is the subject, so it is already the first thing they read in
    // the list view; the preheader repeats the body's opening instead.
    preheader: plainPreheader(args),
    cta: args.link ? { href: args.link, label } : null,
    footer: args.footer ?? "notifications",
    baseUrl: args.baseUrl,
  });

  return { html, text: buildText(args, label) };
}

function plainPreheader(args: MemberEmailArgs): string | null {
  const flat = htmlToPlainText(resolveBody(args)).replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return escapeAttr(flat.slice(0, 140));
}

// Written rather than flattened: the CTA has to arrive as a real URL, because a
// text-only reader has no button to click.
function buildText(args: MemberEmailArgs, label: string): string {
  const parts = [`Hi ${args.firstName},`];
  if (args.titleInBody !== false) parts.push(args.title);
  const body = htmlToPlainText(resolveBody(args));
  if (body) parts.push(body);
  if (args.link) parts.push(`${label}: ${args.link}`);
  parts.push(`DALI OS · ${args.baseUrl}/settings/notifications`);
  return parts.join("\n\n");
}
