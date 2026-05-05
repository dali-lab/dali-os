// Shared helpers for email templating. Subject and body use {{firstName}}
// and {{domain}} placeholders. Body becomes HTML by wrapping double-newline-
// separated paragraphs in <p> tags and converting single newlines to <br/>.

import DOMPurify from "isomorphic-dompurify";

export type InterpolationVars = {
  firstName: string;
  domain?: string;
  time?: string;
  location?: string;
  meetingUrl?: string;
};

export function interpolate(text: string, vars: InterpolationVars): string {
  // Function form so $& / $1 / $$ in the substituted values aren't treated as backrefs.
  return text
    .replace(/\{\{firstName\}\}/g, () => vars.firstName)
    .replace(/\{\{domain\}\}/g, () => vars.domain ?? "")
    .replace(/\{\{time\}\}/g, () => vars.time ?? "")
    .replace(/\{\{location\}\}/g, () => vars.location ?? "")
    .replace(/\{\{meetingUrl\}\}/g, () => vars.meetingUrl ?? "");
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

// Single render path shared by the actual send (api.decisions.$id.release,
// api.my-application) and the cycle-admin Preview modal. Any future addition
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
