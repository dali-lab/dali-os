// The one layout every outbound email is wrapped in.
//
// Pure and dependency-free so it can be unit-tested and previewed without the
// server module graph. Callers pass a body fragment; this adds the document
// around it. See specs/email-standardization.md §3.1.
//
// Why the markup looks dated: email clients are not browsers. Classic Outlook
// for Windows renders through the Word engine, which Microsoft supports "until
// at least 2029" and which is over-represented in EDU. It has no flexbox, no
// grid, no border-radius, no rem, and no @media, and honours max-width only on
// a <table>. So the structure is tables with role="presentation", widths in the
// style attribute plus an MSO conditional ghost table, padding on <td> rather
// than margins, and a system font stack. A single-column transactional email
// needs none of the things we give up.
//
// Dark mode cannot be opted out of. Roughly 42% of clients honour
// prefers-color-scheme and Gmail honours it on none of its four, so that block
// is progressive enhancement, never load-bearing. Outlook.com rewrites
// low-contrast colours and stashes the originals in data-ogsc, so it gets its
// own selector and is excluded from the media query (it prefixes every class
// with "x_"). Literal #ffffff and #000000 are avoided because Apple Mail and
// Outlook.com special-case those exact values.

export type EmailFooter = "notifications" | "transactional" | "none";

export type EmailLayoutArgs = {
  // Body fragment. Already sanitized by the caller — this module never
  // sanitizes, so that the single sanitization point stays visible at the call
  // site rather than being implied here.
  bodyHtml: string;
  // Inbox preview line. Falls back to nothing rather than leaking the first
  // words of the body, which is what clients show when it is absent.
  preheader?: string | null;
  cta?: { href: string; label: string } | null;
  footer?: EmailFooter;
  // Absolute base URL of the app, for footer links.
  baseUrl: string;
  // Non-prod warning rendered inside <body>, after the opening tag. Never
  // prepended to the document, which would put a <div> before the doctype.
  envNotice?: string | null;
};

const COLORS = {
  // Near-white and near-black rather than pure, so clients that key off the
  // exact literals leave these alone.
  pageBg: "#f4f4f5",
  cardBg: "#fffffe",
  text: "#18181b",
  muted: "#52525b",
  // Dark enough to pass contrast on white, light enough to survive inversion.
  link: "#1d4ed8",
  border: "#e4e4e7",
  buttonBg: "#18181b",
  buttonText: "#fffffe",
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const WIDTH = 600;

export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function button(cta: { href: string; label: string }): string {
  // Square corners, so no VML fallback is needed for Outlook. A table rather
  // than a padded <a>, because Outlook drops padding on inline elements.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
<tr><td align="center" bgcolor="${COLORS.buttonBg}" style="background:${COLORS.buttonBg};">
<a href="${escapeAttr(cta.href)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:600;color:${COLORS.buttonText};text-decoration:none;">${cta.label}</a>
</td></tr></table>`;
}

function footerHtml(kind: EmailFooter, baseUrl: string): string {
  if (kind === "none") return "";
  const base = escapeAttr(baseUrl.replace(/\/$/, ""));
  const link = (href: string, label: string) =>
    `<a href="${href}" style="color:${COLORS.muted};text-decoration:underline;">${label}</a>`;
  // Transactional mail gets no settings link: a decision letter or a signed
  // agreement receipt is not something a member can turn off, and offering the
  // link implies they can.
  const inner =
    kind === "notifications"
      ? `DALI OS &middot; ${link(`${base}/settings/notifications`, "notification settings")}`
      : `DALI OS &middot; DALI Lab at Dartmouth College`;
  return `<tr><td style="padding:0 32px 32px;font-family:${FONT};font-size:12px;line-height:18px;color:${COLORS.muted};">
<div style="border-top:1px solid ${COLORS.border};padding-top:16px;">${inner}</div>
</td></tr>`;
}

export function renderEmailDocument(args: EmailLayoutArgs): string {
  const footer = args.footer ?? "notifications";
  const cta = args.cta ? button(args.cta) : "";
  const notice = args.envNotice ?? "";

  // Hidden preheader, then a run of zero-width joiners so the client does not
  // pull body text in after it.
  const preheader = args.preheader
    ? `<div style="display:none;font-size:1px;color:${COLORS.cardBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${args.preheader}${"&zwnj;&nbsp;".repeat(30)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>DALI OS</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin:0; padding:0; width:100% !important; }
img { border:0; outline:none; text-decoration:none; }
a { color:${COLORS.link}; }
@media (prefers-color-scheme: dark) {
  .dali-page:not([class^="x_"]) { background:#111113 !important; }
  .dali-card:not([class^="x_"]) { background:#1c1c1f !important; }
  .dali-text:not([class^="x_"]), .dali-text:not([class^="x_"]) * { color:#f4f4f5 !important; }
  .dali-muted:not([class^="x_"]), .dali-muted:not([class^="x_"]) * { color:#a1a1aa !important; }
}
[data-ogsc] .dali-page { background:#111113 !important; }
[data-ogsc] .dali-card { background:#1c1c1f !important; }
[data-ogsc] .dali-text, [data-ogsc] .dali-text * { color:#f4f4f5 !important; }
[data-ogsc] .dali-muted, [data-ogsc] .dali-muted * { color:#a1a1aa !important; }
@media only screen and (max-width: 620px) {
  .dali-pad { padding-left:20px !important; padding-right:20px !important; }
}
</style>
</head>
<body class="dali-page" style="margin:0;padding:0;background:${COLORS.pageBg};">
${notice}${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="dali-page" style="background:${COLORS.pageBg};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" width="${WIDTH}"><tr><td><![endif]-->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="dali-card" style="max-width:${WIDTH}px;background:${COLORS.cardBg};border:1px solid ${COLORS.border};">
<tr><td class="dali-pad dali-text" style="padding:32px 32px 8px;font-family:${FONT};font-size:16px;line-height:24px;color:${COLORS.text};">
${args.bodyHtml}
${cta}
</td></tr>
<tr><td class="dali-pad dali-muted" style="padding:0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="dali-muted">
${footerHtml(footer, args.baseUrl)}
</table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
}
