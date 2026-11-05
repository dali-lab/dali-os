// The cards on the /help hub. Client-safe and data-only so the palette search can
// index it. Full articles live in app/help/articles/.

export interface HelpArticle {
  slug: string;
  href: string;
  title: string;
  /** One-line description, shown on the /help index card. */
  summary: string;
  /** Section headings + synonyms, so an article is findable by topic. */
  keywords?: string[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "getting-started",
    href: "/help/articles/getting-started",
    title: "Getting started",
    summary: "A short tour of the sidebar and the things you'll touch most often.",
    keywords: ["home", "calendar", "projects", "hiring", "members", "sidebar", "tour"],
  },
  {
    slug: "shortcuts",
    href: "/help/shortcuts",
    title: "Keyboard shortcuts",
    summary: "Tabs, navigation, docs, Calendar, and Drive.",
    keywords: ["keyboard", "hotkeys", "tabs", "navigation", "docs", "calendar", "drive"],
  },
  {
    slug: "calendar",
    href: "/help/articles/calendar",
    title: "Calendar",
    summary: "How linked Google accounts, working hours, and buffers affect scheduling.",
    keywords: ["google", "working hours", "buffers", "scheduling", "linking", "availability"],
  },
  {
    slug: "staffing",
    href: "/help/articles/staffing",
    title: "Staffing",
    summary: "Intent to work, project bids, level-up, and how PMs see them.",
    keywords: ["intent to work", "project bids", "level-up", "placement", "pm"],
  },
  {
    slug: "notifications",
    href: "/help/articles/notifications",
    title: "Notifications",
    summary: "What the bell shows, how RSVPs work, where reminders come from.",
    keywords: ["bell", "rsvp", "reminders", "meeting invites", "channels", "preferences"],
  },
  {
    slug: "mcp",
    href: "/help/mcp",
    title: "Connect AI assistants",
    summary: "Wire Claude Code, Codex, or Claude Desktop into DALI OS via MCP.",
    keywords: ["mcp", "claude code", "codex", "claude desktop", "ai", "assistant", "resources", "prompts"],
  },
];
