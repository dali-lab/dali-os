// Shared helpers for email templating. Subject and body use {{firstName}}
// and {{domain}} placeholders. Body becomes HTML by wrapping double-newline-
// separated paragraphs in <p> tags and converting single newlines to <br/>.

import DOMPurify from "isomorphic-dompurify";
import { interpolateVars, type VariableInContext } from "~/lib/template-variables";

/** Every token the email surface offers, read off the registry. */
export type EmailVariableName = VariableInContext<"email">;

// Was a hand-written restatement of the six email tokens, which is how adding one
// to the registry could compile everywhere except the call that passed it.
// firstName stays required: these are letters that open "Hi {{firstName}}".
export type InterpolationVars = { firstName: string } & Partial<
  Record<Exclude<EmailVariableName, "firstName">, string>
>;

/** Vars for a template addressed by registry key, where the key's own
 *  `variables` list is the contract — including the blocks that have no
 *  greeting, so firstName isn't owed. */
export type EmailTemplateVars = Partial<Record<EmailVariableName, string>>;

// Escape every value before it is spliced into a template body that becomes HTML.
// Operator-authored markup in the template survives; a value does not. That
// distinction is the whole point: the template may legitimately contain
// `<a href="…">`, while a value like a course title or a domain name is data and
// must never introduce markup. Subjects are NOT escaped — they end up in a mail
// header as plain text, where `&amp;` would be literal.
function escapeValues(vars: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, escapeHtml(v)]));
}

// Optional vars arrive as explicit `undefined` keys (an interview with no
// meeting link); render them as "" like `interpolate` does for missing ones.
function blankUndefined(vars: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v ?? ""]));
}

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

// Escape a plain-text value before splicing it into a hand-built HTML email
// string (body or double-quoted attribute). Use this for any user-controlled
// value — names, offering/assignment titles, locations — that isn't already
// run through bodyToHtml/renderEmail (which escape via DOMPurify). Skipping it
// lets a "<" or "&" in a title break rendering or inject markup.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

// Plain-text mirror of an HTML body. Two consumers with different needs, one
// implementation:
//   - the in-app feed and Slack DM, which don't render HTML and must fit the
//     Notification.body column — those pass maxLength
//   - the text/plain MIME alternative on an outbound email, which must NOT be
//     truncated or the message ends mid-sentence
// Links flatten to "label (url)" so the destination survives in both; that is
// load-bearing for the email part, where the CTA is otherwise unreachable.
//
// This replaced a second, regex-based copy in lib/gmail.ts. That one iterated
// its tag-strip to defeat `<scr<script>ipt>` and deliberately left &lt;/&gt;
// encoded; DOMPurify handles the former properly, and the latter was unnecessary
// caution — the output is a text/plain part or a React text node, so angle
// brackets are inert in both and the reader should see what the author typed.
export function htmlToPlainText(html: string, opts?: { maxLength?: number }): string {
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
  return opts?.maxLength === undefined ? s : s.slice(0, opts.maxLength);
}

// The Notification.body column's limit. Named so the two call sites that write
// that column can't drift from each other.
export const NOTIFICATION_BODY_MAX = 2000;

// Single render path shared by the actual send (api.decisions.$id.release,
// portal.apply) and the cycle-admin Preview modal. Any future addition
// to the pipeline — sanitization, footer/signature, locale handling — should
// live here so the preview never drifts from what actually goes out.
export function renderEmail(
  template: { subject: string; body: string },
  rawVars: Record<string, string | undefined>,
): { subject: string; html: string } {
  const vars = blankUndefined(rawVars);
  const text = interpolateVars(template.subject, vars);
  return {
    // Plain: this becomes a Subject header.
    subject: text,
    // Rich: the operator may write a link, bold, or a list, and every value
    // spliced in is escaped first so data can't become markup.
    html: bodyToRichHtml(interpolateVars(template.body, escapeValues(vars))),
  };
}

// Paragraph-wrap an operator-authored body, then sanitize it with the wider
// allowlist so links, bold and lists survive.
//
// This replaced bodyToHtml on the template path. bodyToHtml's `["p","br"]`
// allowlist meant an operator literally could not put a clickable link in an
// email — a booking link had to be a bare URL relying on the client to autolink
// it. The narrow path stays for notification bodies, which are one plain sentence
// mixing operator copy with user-authored data (a task title, a comment preview)
// and so must not be allowed to carry markup at all.
export function bodyToRichHtml(body: string): string {
  const wrapped = body
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
  return sanitizeRichEmailHtml(wrapped);
}
