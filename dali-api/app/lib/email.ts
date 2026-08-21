// Shared helpers for email templating. Subject and body use {{firstName}}
// and {{domain}} placeholders. Body becomes HTML by wrapping double-newline-
// separated paragraphs in <p> tags and converting single newlines to <br/>.

import DOMPurify from "isomorphic-dompurify";
import { interpolateVars } from "~/lib/template-variables";

export type InterpolationVars = {
  firstName: string;
  domain?: string;
  time?: string;
  location?: string;
  meetingUrl?: string;
  originalCloseDate?: string;
  newCloseDate?: string;
};

export function interpolate(text: string, vars: InterpolationVars): string {
  // Delegate to the shared interpolator with the email vocabulary mapped to
  // strings (missing optional vars → "", unknown tokens left as literal text).
  return interpolateVars(text, {
    firstName: vars.firstName,
    domain: vars.domain ?? "",
    time: vars.time ?? "",
    location: vars.location ?? "",
    meetingUrl: vars.meetingUrl ?? "",
    originalCloseDate: vars.originalCloseDate ?? "",
    newCloseDate: vars.newCloseDate ?? "",
  });
}

// Sanitization is part of the contract: template bodies are user-authored
// (hiring leads) and rendered with dangerouslySetInnerHTML in the admin
// preview modal, so any HTML beyond the <p>/<br> shape this helper emits
// must be stripped to neutralize stored XSS.
export function bodyToHtml(body: string): string {
  const raw = body
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
  return DOMPurify.sanitize(raw, { ALLOWED_TAGS: ["p", "br"], ALLOWED_ATTR: [] });
}

// Rich-text email bodies (e.g. the announcements composer) are authored in the
// DocEditor and serialized to HTML. This is the email-safe sanitizer: a small
// allowlist of formatting/link tags that render consistently across mail
// clients, links restricted to http(s)/mailto (no javascript:/data:), and
// target/rel forced on every anchor. bodyToHtml above stays the plain-text path.
const RICH_EMAIL_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s",
  "a", "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "code", "pre",
];

export function sanitizeRichEmailHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: RICH_EMAIL_TAGS,
    ALLOWED_ATTR: ["href"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
  // DOMPurify drops author-supplied target/rel (not in ALLOWED_ATTR), so this
  // injection is deterministic — every surviving anchor opens safely.
  return clean.replace(/<a\b/gi, '<a target="_blank" rel="noopener noreferrer nofollow"');
}

// Remove all tags, keeping text content. DOMPurify (not a hand-rolled regex) so
// there's no partial-tag bypass — callers decodeEntities() the result, which
// also undoes DOMPurify's re-encoding of text-node & < >.
function stripTags(s: string): string {
  return DOMPurify.sanitize(s, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

// Decode the entities our own serializers emit. &amp; is decoded LAST so an
// escaped entity like "&amp;lt;" resolves to "&lt;", not "<".
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Plain-text mirror of a rich HTML body for the in-app feed and Slack DM, which
// don't render HTML. Links flatten to "label (url)" so the destination survives;
// lists become bullet lines. Capped to 2000 to fit the Notification.body column.
export function htmlToPlainText(html: string): string {
  let s = html;
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
    const label = decodeEntities(stripTags(inner)).trim();
    const url = decodeEntities(href).trim();
    if (!label || label === url) return url;
    return `${label} (${url})`;
  });
  s = s.replace(/<li\b[^>]*>/gi, "\n• ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|h1|h2|h3|div|li|ul|ol|blockquote|pre)>/gi, "\n");
  s = decodeEntities(stripTags(s));
  s = s
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.slice(0, 2000);
}

// Single render path shared by the actual send (api.decisions.$id.release,
// portal.apply) and the cycle-admin Preview modal. Any future addition
// to the pipeline — sanitization, footer/signature, locale handling — should
// live here so the preview never drifts from what actually goes out.
export function renderEmail(
  template: { subject: string; body: string },
  vars: InterpolationVars,
): { subject: string; html: string } {
  return {
    subject: interpolate(template.subject, vars),
    html: bodyToHtml(interpolate(template.body, vars)),
  };
}
