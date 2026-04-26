// Shared helpers for email templating. Subject and body in EmailTemplateVersion
// (and the legacy table) are plain text with `{{firstName}}` placeholders;
// the body becomes HTML by wrapping double-newline-separated paragraphs in <p>
// tags and converting single newlines to <br/>.

export function interpolate(text: string, firstName: string): string {
  // Function form so $& / $1 / $$ in firstName aren't treated as backrefs.
  return text.replace(/\{\{firstName\}\}/g, () => firstName);
}

export function bodyToHtml(body: string): string {
  return body
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}
