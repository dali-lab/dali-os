export const HELP_AUDIENCES = [
  "member",
  "mentor",
  "core",
  "admin",
  "staff",
  "domain-lead",
  "instructor",
  "interviewer",
] as const;

export type HelpAudience = (typeof HELP_AUDIENCES)[number];

export type HelpArticleDoc = {
  slug: string;
  title: string;
  summary: string;
  /** Who can see it; any match is enough. Empty means every lab member. */
  audience: HelpAudience[];
  flag: string | null;
  /** App paths the article describes, like /rooms or /projects/:id. */
  paths: string[];
  keywords: string[];
  url: string;
  body: string;
};

export class HelpArticleFormatError extends Error {}

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const KNOWN_KEYS = new Set(["title", "summary", "audience", "flag", "paths", "keywords"]);

function unquote(v: string): string {
  const t = v.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
}

function parseList(v: string): string[] {
  const t = v.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return t ? [unquote(t)] : [];
  return t
    .slice(1, -1)
    .split(",")
    .map(unquote)
    .filter(Boolean);
}

export const helpArticleUrl = (slug: string) => `/help/articles/${slug}`;

export function parseHelpArticle(slug: string, raw: string): HelpArticleDoc {
  const text = raw.replace(/\r\n/g, "\n");
  const match = FRONTMATTER.exec(text);
  if (!match) throw new HelpArticleFormatError(`${slug}: missing the --- header`);
  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    if (colon < 1) throw new HelpArticleFormatError(`${slug}: can't read header line "${line}"`);
    const key = line.slice(0, colon).trim();
    if (!KNOWN_KEYS.has(key)) throw new HelpArticleFormatError(`${slug}: unknown header field "${key}"`);
    fields.set(key, line.slice(colon + 1));
  }
  const title = unquote(fields.get("title") ?? "");
  const summary = unquote(fields.get("summary") ?? "");
  if (!title) throw new HelpArticleFormatError(`${slug}: needs a title`);
  if (!summary) throw new HelpArticleFormatError(`${slug}: needs a summary`);
  const audience = parseList(fields.get("audience") ?? "");
  for (const a of audience) {
    if (!(HELP_AUDIENCES as readonly string[]).includes(a)) {
      throw new HelpArticleFormatError(`${slug}: unknown audience "${a}"`);
    }
  }
  const flag = unquote(fields.get("flag") ?? "") || null;
  return {
    slug,
    title,
    summary,
    audience: audience as HelpAudience[],
    flag,
    paths: parseList(fields.get("paths") ?? ""),
    keywords: parseList(fields.get("keywords") ?? ""),
    url: helpArticleUrl(slug),
    body: text.slice(match[0].length).trim(),
  };
}
