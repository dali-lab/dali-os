import { isLabMentor, type UserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { FEATURE_FLAGS, type FeatureFlagKey } from "~/lib/feature-flags";
import { SHORTCUT_SECTIONS } from "~/lib/shortcuts";
import { parseHelpArticle, type HelpArticleDoc, type HelpAudience } from "./article-format";

const FILES = import.meta.glob<string>("./articles/*.md", { query: "?raw", import: "default", eager: true });

export function shortcutsArticle(): HelpArticleDoc {
  const body = SHORTCUT_SECTIONS.map((s) =>
    [`## ${s.title}`, ...(s.note ? [s.note] : []), "", ...s.rows.map((r) => `- ${r.keys}: ${r.action}`)].join("\n"),
  ).join("\n\n");
  return {
    slug: "shortcuts",
    title: "Keyboard shortcuts",
    summary: "Every keyboard shortcut in DALI OS. On Windows and Linux, Ctrl stands in for ⌘ and Alt for ⌥.",
    audience: [],
    flag: null,
    paths: ["/help/shortcuts"],
    keywords: ["keyboard", "hotkeys", "keys"],
    url: "/help/shortcuts",
    body,
  };
}

export function loadHelpArticles(files: Record<string, string> = FILES): HelpArticleDoc[] {
  const fromFiles = Object.entries(files).map(([path, raw]) =>
    parseHelpArticle(path.replace(/^.*\/([^/]+)\.md$/, "$1"), raw),
  );
  return [...fromFiles, shortcutsArticle()].sort((a, b) => a.title.localeCompare(b.title));
}

let cached: HelpArticleDoc[] | null = null;
export function helpArticles(): HelpArticleDoc[] {
  cached ??= loadHelpArticles();
  return cached;
}

export type HelpViewer = { userId: string; roles: UserRoles; request?: Request };

const ROLE_AUDIENCES: Record<Exclude<HelpAudience, "mentor">, keyof UserRoles> = {
  member: "isLabMember",
  core: "isCore",
  admin: "isAdmin",
  staff: "isStaff",
  "domain-lead": "isDomainLead",
  instructor: "isInstructor",
  interviewer: "isInterviewer",
};

const isFlagKey = (key: string): key is FeatureFlagKey => FEATURE_FLAGS.some((f) => f.key === key);

export async function visibleHelpArticles(
  viewer: HelpViewer,
  articles: HelpArticleDoc[] = helpArticles(),
): Promise<HelpArticleDoc[]> {
  if (!viewer.roles.isLabMember && !viewer.roles.isCore) return [];
  let mentor: Promise<boolean> | null = null;
  const flags = new Map<string, Promise<boolean>>();
  const inAudience = async (a: HelpArticleDoc) => {
    if (a.audience.length === 0) return true;
    for (const who of a.audience) {
      if (who === "mentor") {
        mentor ??= isLabMentor(viewer.userId, undefined, viewer.request);
        if (await mentor) return true;
      } else if (viewer.roles[ROLE_AUDIENCES[who]]) {
        return true;
      }
    }
    return false;
  };
  const flagOn = (flag: string | null) => {
    if (!flag) return Promise.resolve(true);
    if (!isFlagKey(flag)) return Promise.resolve(false);
    let on = flags.get(flag);
    if (!on) {
      on = isFeatureEnabled(flag, viewer.userId, viewer.roles, viewer.request);
      flags.set(flag, on);
    }
    return on;
  };
  const shown = await Promise.all(articles.map(async (a) => (await flagOn(a.flag)) && (await inAudience(a))));
  return articles.filter((_, i) => shown[i]);
}

export async function findHelpArticle(viewer: HelpViewer, slug: string): Promise<HelpArticleDoc | null> {
  const article = helpArticles().find((a) => a.slug === slug);
  if (!article) return null;
  return (await visibleHelpArticles(viewer, [article]))[0] ?? null;
}
