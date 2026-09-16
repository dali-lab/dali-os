// The /help help-center articles. Client-safe, data-only (no route/loader
// imports) so it loads in the browser bundle and in the command-palette search
// without pulling server code. The /help index renders its cards from this, and
// search.server.ts indexes it — one source of truth, so titles/summaries can't
// drift between the two. `keywords` mirror each article's section headings plus
// synonyms, since the prose itself is JSX and can't be indexed at runtime.

export interface HelpArticle {
  /** URL is /help/<slug>. */
  slug: string;
  title: string;
  /** One-line description, shown on the /help index card. */
  summary: string;
  /** Section headings + synonyms, so an article is findable by topic. */
  keywords?: string[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    summary: "A short tour of the sidebar and the things you'll touch most often.",
    keywords: ["home", "calendar", "projects", "hiring", "members", "sidebar", "tour"],
  },
  {
    slug: "shortcuts",
    title: "Keyboard shortcuts",
    summary: "Tabs, panes, in-tab navigation. Stays out of your way until you want it.",
    keywords: ["keyboard", "hotkeys", "tabs", "panes", "navigation"],
  },
  {
    slug: "calendar",
    title: "Calendar",
    summary: "How linked Google accounts, working hours, and buffers affect scheduling.",
    keywords: ["google", "working hours", "buffers", "scheduling", "linking", "availability"],
  },
  {
    slug: "staffing",
    title: "Staffing",
    summary: "Intent to work, project bids, level-up, and how PMs see them.",
    keywords: ["intent to work", "project bids", "level-up", "placement", "pm"],
  },
  {
    slug: "notifications",
    title: "Notifications",
    summary: "What the bell shows, how RSVPs work, where reminders come from.",
    keywords: ["bell", "rsvp", "reminders", "meeting invites", "channels", "preferences"],
  },
  {
    slug: "mcp",
    title: "Connect AI assistants",
    summary: "Wire Claude Code, Codex, or Claude Desktop into DALI OS via MCP.",
    keywords: ["mcp", "claude code", "codex", "claude desktop", "ai", "assistant", "resources", "prompts"],
  },
];
