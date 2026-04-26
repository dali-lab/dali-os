// Shared helpers for email templating. Subject and body use {{firstName}}
// and {{domain}} placeholders. Body becomes HTML by wrapping double-newline-
// separated paragraphs in <p> tags and converting single newlines to <br/>.

export type InterpolationVars = {
  firstName: string;
  domain?: string;
};

export function interpolate(text: string, vars: InterpolationVars): string {
  // Function form so $& / $1 / $$ in the substituted values aren't treated as backrefs.
  return text
    .replace(/\{\{firstName\}\}/g, () => vars.firstName)
    .replace(/\{\{domain\}\}/g, () => vars.domain ?? "");
}

export function bodyToHtml(body: string): string {
  return body
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}
