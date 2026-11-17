import { prisma } from "~/lib/db.server";
import { pageOpenHref } from "~/drive/lib/page-href";
import { notePageId } from "~/lib/mobile-notes";
import type { SearchResult, SearchResultType } from "~/lib/search";
import type { AskSourceInput, AskSourceKind } from "./sources";
import type { runMcpSearch } from "~/mcp/tools/docs/search";
import type { runSearchDirectory } from "~/mcp/tools/search-directory";
import type { runGetMemberProfile } from "~/mcp/tools/get-member-profile";
import type { runReadPage } from "~/mcp/tools/read-page";
import type { runListProjectPages } from "~/mcp/tools/list-project-pages";
import type { runGetMeeting } from "~/mcp/tools/calendar-extra/get-meeting";
import type { runGetMeetingTranscript } from "~/mcp/tools/calendar-extra/get-meeting-transcript";
import type { runSearchCalendar } from "~/mcp/tools/calendar-extra/search-calendar";
import type { runListMyUpcomingMeetings } from "~/mcp/tools/list-my-upcoming-meetings";
import type { runListMyTasks } from "~/mcp/tools/list-my-tasks";
import type { runGetTask } from "~/mcp/tools/get-task";
import type { runListMyProjects } from "~/mcp/tools/list-my-projects";
import type { runReadHelp } from "~/mcp/tools/read-help";
import type { runGetProjectOverview } from "~/mcp/tools/get-project-overview";

type Args = Record<string, unknown>;

export const ASK_TRANSCRIPT_PAGE_LINES = 300;
export const ASK_TRANSCRIPT_MAX_LINES = 500;

type AskToolOf<P> = {
  status: (args: Args) => string;
  guard?: (args: Args) => string | null;
  args?: (args: Args) => Args;
  filter?: (payload: P) => P;
  sources: (args: Args, payload: P) => AskSourceInput[] | Promise<AskSourceInput[]>;
};

export type AskTool = AskToolOf<unknown>;

type Run = (...a: never[]) => Promise<unknown>;
type Payload<R extends Run> = Awaited<ReturnType<R>>;

function defineAskTool<R extends Run>(tool: AskToolOf<Payload<R>>): AskTool {
  return tool as AskTool;
}

export const ASK_SEARCH_CATEGORIES = [
  "person",
  "group",
  "project",
  "task",
  "education",
  "document",
  "form",
  "guide",
  "helpArticle",
] as const satisfies readonly (SearchResultType & AskSourceKind)[];

const searchAllowed = new Set<string>(ASK_SEARCH_CATEGORIES);

const str = (v: string | null | undefined): string | null => (v ? v : null);
const name = (p: { firstName?: string | null; lastName?: string | null }) =>
  [str(p.firstName), str(p.lastName)].filter(Boolean).join(" ") || "Member";
const quoted = (args: Args) => (typeof args.q === "string" && args.q ? ` for "${args.q}"` : "");

const meetingUrl = (id: string) => `/calendar/meeting/${id}`;
const taskUrl = (projectId: string, id: string) => `/projects/${projectId}?tab=board&task=${id}`;

function person(p: { id: string; firstName?: string | null; lastName?: string | null }): AskSourceInput[] {
  const id = str(p.id);
  return id ? [{ kind: "person", title: name(p), url: `/members/${id}` }] : [];
}

function project(p: { id: string; name: string }): AskSourceInput[] {
  const id = str(p.id);
  return id ? [{ kind: "project", title: str(p.name) ?? "Project", url: `/projects/${id}` }] : [];
}

function task(t: { id: string; title: string; dueAt: string | null }, projectId: string | null): AskSourceInput[] {
  const id = str(t.id);
  if (!id || !projectId) return [];
  return [{ kind: "task", title: str(t.title) ?? "Task", url: taskUrl(projectId, id), date: str(t.dueAt) }];
}

const ARTICLE_LINK = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

/** The in-site pages a help article links to, so an answer can send someone straight there. */
function articleLinks(body: string): AskSourceInput[] {
  return [...body.matchAll(ARTICLE_LINK)].map(([, title, url]) => ({
    kind: url.startsWith("/help/articles/") ? "helpArticle" : "page",
    title,
    url,
  }));
}

function flattenPages<T extends { children: T[] }>(nodes: T[]): T[] {
  return nodes.flatMap((n) => [n, ...flattenPages(n.children)]);
}

const TOOLS = {
  search: defineAskTool<typeof runMcpSearch>({
    status: (args) => `Searching${quoted(args)}`,
    guard: (args) =>
      args.category !== undefined && !searchAllowed.has(String(args.category))
        ? `Category '${args.category}' isn't available here. Use one of: ${ASK_SEARCH_CATEGORIES.join(", ")}`
        : null,
    filter: (p) => {
      const results = p.results.filter((r) => searchAllowed.has(r.type));
      return "categoriesWithMore" in p
        ? { ...p, results, categoriesWithMore: p.categoriesWithMore.filter((c) => searchAllowed.has(c)) }
        : { ...p, results };
    },
    sources: (_args, p) =>
      p.results.flatMap((r) =>
        searchAllowed.has(r.type) && r.url
          ? [{ kind: r.type as AskSourceKind, title: r.title, url: r.url, detail: r.subtitle ?? null }]
          : [],
      ),
  }),
  search_directory: defineAskTool<typeof runSearchDirectory>({
    status: (args) => `Looking up people${quoted(args)}`,
    sources: (_args, p) => p.results.flatMap(person),
  }),
  get_member_profile: defineAskTool<typeof runGetMemberProfile>({
    status: () => "Reading a profile",
    sources: (_args, p) => person(p),
  }),
  read_page: defineAskTool<typeof runReadPage>({
    status: () => "Reading a document",
    sources: (_args, p) =>
      p.id ? [{ kind: "document", title: str(p.title) ?? "Document", url: pageOpenHref(p.kind, p.id) }] : [],
  }),
  list_project_pages: defineAskTool<typeof runListProjectPages>({
    status: () => "Listing project documents",
    sources: (_args, p) =>
      flattenPages(p.pages).flatMap((n) =>
        n.id ? [{ kind: "document" as const, title: str(n.title) ?? "Document", url: pageOpenHref(n.kind, n.id) }] : [],
      ),
  }),
  get_meeting: defineAskTool<typeof runGetMeeting>({
    status: () => "Reading a meeting",
    sources: (_args, m) =>
      m.meetingId ? [{ kind: "meeting", title: str(m.title) ?? "Meeting", url: meetingUrl(m.meetingId), date: m.startsAt }] : [],
  }),
  get_meeting_transcript: defineAskTool<typeof runGetMeetingTranscript>({
    status: () => "Reading a transcript",
    args: (args) => ({
      ...args,
      limit: Math.min(typeof args.limit === "number" && args.limit > 0 ? args.limit : ASK_TRANSCRIPT_PAGE_LINES, ASK_TRANSCRIPT_MAX_LINES),
    }),
    sources: async (_args, p) => {
      const recordingId = p.recordingId;
      if (!recordingId) return [];
      const rec = await prisma.meetingRecording.findUnique({
        where: { id: recordingId },
        select: { documentName: true, createdAt: true, scheduledMeeting: { select: { title: true } } },
      });
      const pageId = rec ? notePageId(rec.documentName) : null;
      if (!rec || !pageId) return [];
      return [
        {
          kind: "transcript",
          title: rec.scheduledMeeting?.title ?? "Meeting transcript",
          url: `/documents/${pageId}?transcript=${recordingId}`,
          date: rec.createdAt.toISOString(),
          detail: "Transcript",
        },
      ];
    },
  }),
  search_calendar: defineAskTool<typeof runSearchCalendar>({
    status: (args) => `Searching the calendar${quoted(args)}`,
    sources: (_args, p) =>
      p.local.flatMap((h) => {
        const id = str(h.id.replace(/^meeting:/, ""));
        return id ? [{ kind: "meeting" as const, title: str(h.title) ?? "Meeting", url: meetingUrl(id), date: h.startIso }] : [];
      }),
  }),
  list_my_upcoming_meetings: defineAskTool<typeof runListMyUpcomingMeetings>({
    status: () => "Checking your upcoming meetings",
    filter: (p) => ({ ...p, meetings: p.meetings.filter((m) => m.source === "dali") }),
    sources: (_args, p) =>
      p.meetings.flatMap((m) =>
        m.id && m.source === "dali"
          ? [{ kind: "meeting" as const, title: str(m.title) ?? "Meeting", url: meetingUrl(m.id), date: m.startsAt }]
          : [],
      ),
  }),
  list_my_tasks: defineAskTool<typeof runListMyTasks>({
    status: () => "Checking your tasks",
    sources: (_args, p) => p.tasks.flatMap((t) => task(t, str(t.projectId))),
  }),
  get_task: defineAskTool<typeof runGetTask>({
    status: () => "Reading a task",
    sources: (_args, t) => task(t, str(t.project.id)),
  }),
  list_my_projects: defineAskTool<typeof runListMyProjects>({
    status: () => "Checking your projects",
    sources: (_args, p) => p.projects.flatMap(project),
  }),
  read_help: defineAskTool<typeof runReadHelp>({
    status: (args) => (typeof args.slug === "string" && args.slug ? "Reading the help" : "Checking the help"),
    sources: (_args, a) => {
      if (!("url" in a) || !a.url) return [];
      return [{ kind: "helpArticle", title: str(a.title) ?? "Help", url: a.url }, ...articleLinks(a.body)];
    },
  }),
  get_project_overview: defineAskTool<typeof runGetProjectOverview>({
    status: () => "Reading a project",
    sources: (_args, p) => project(p),
  }),
};

export type AskToolName = keyof typeof TOOLS;

export const ASK_TOOLS: Record<string, AskTool> = TOOLS;

export const ASK_TOOL_NAMES = Object.keys(TOOLS) as AskToolName[];
