// No imports: demo-write.yml's gate runs this with plain Node before npm install.
const RELEASE_NOTE_HEADING = /^#{1,6}\s*release\s+notes?\s*:?\s*$/i;
const EMPTY_NOTE = /^(none|n\/?a|-+)\.?$/i;
// Text bots append below the last section: the Claude attribution line and the
// Blacksmith codesmith footer (a --- rule inside codesmith:footer comments).
const BOT_FOOTER = /<!--\s*codesmith:footer\s*-->[\s\S]*?<!--\s*\/codesmith:footer\s*-->/g;
const ATTRIBUTION = /^🤖\s*Generated with\b/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;

export function releaseNoteLine(body: string | null): string | null {
  const lines = (body ?? "").replace(BOT_FOOTER, "").replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);
  const start = lines.findIndex((l) => RELEASE_NOTE_HEADING.test(l.trim()));
  if (start === -1) return null;
  const paragraph: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line) || RULE.test(line) || ATTRIBUTION.test(line)) break;
    if (!line) {
      if (paragraph.length) break;
      continue;
    }
    const text = line.replace(/^[-*]\s+/, "").trim();
    if (text && !EMPTY_NOTE.test(text)) paragraph.push(text);
  }
  return paragraph.length ? paragraph.join(" ") : null;
}
