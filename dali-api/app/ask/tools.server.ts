import { prisma } from "~/lib/db.server";
import { pageOpenHref } from "~/lib/page-href";
import { notePageId } from "~/lib/mobile-notes";
import type { SearchResult, SearchResultType } from "~/lib/search";
import type { AskSourceInput, AskSourceKind } from "./sources";

type Args = Record<string, unknown>;

export type AskTool = {
  status: (args: Args) => string;
  guard?: (args: Args) => string | null;
  filter?: (payload: unknown) => unknown;
  sources: (args: Args, payload: unknown) => AskSourceInput[] | Promise<AskSourceInput[]>;
};

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

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const name = (p: Obj) => [str(p.firstName), str(p.lastName)].filter(Boolean).join(" ") || "Member";
const quoted = (args: Args) => (str(args.q) ? ` for "${args.q}"` : "");

const meetingUrl = (id: string) => `/calendar/meeting/${id}`;
const taskUrl = (projectId: string, id: string) => `/projects/${projectId}?tab=board&task=${id}`;

function person(p: Obj): AskSourceInput[] {
  const id = str(p.id);
  return id ? [{ kind: "person", title: name(p), url: `/members/${id}` }] : [];
}

function project(p: Obj): AskSourceInput[] {
  const id = str(p.id);
  return id ? [{ kind: "project", title: str(p.name) ?? "Project", url: `/projects/${id}` }] : [];
}

function task(t: Obj, projectId: string | null): AskSourceInput[] {
  const id = str(t.id);
  if (!id || !projectId) return [];
  return [{ kind: "task", title: str(t.title) ?? "Task", url: taskUrl(projectId, id), date: str(t.dueAt) }];
}

function flattenPages(nodes: Obj[]): Obj[] {
  return nodes.flatMap((n) => [n, ...flattenPages(list(n.children))]);
}

export const ASK_TOOLS: Record<string, AskTool> = {
  search: {
    status: (args) => `Searching${quoted(args)}`,
    guard: (args) =>
      args.category !== undefined && !searchAllowed.has(String(args.category))
        ? `Category '${args.category}' isn't available here. Use one of: ${ASK_SEARCH_CATEGORIES.join(", ")}`
        : null,
    filter: (payload) => {
      const p = obj(payload);
      return {
        ...p,
        results: list(p.results).filter((r) => searchAllowed.has(String(r.type))),
        ...(Array.isArray(p.categoriesWithMore)
          ? { categoriesWithMore: p.categoriesWithMore.filter((c) => searchAllowed.has(String(c))) }
          : {}),
      };
    },
    sources: (_args, payload) =>
      (list(obj(payload).results) as unknown as SearchResult[]).flatMap((r) =>
        searchAllowed.has(r.type) && r.url
          ? [{ kind: r.type as AskSourceKind, title: r.title, url: r.url, detail: r.subtitle ?? null }]
          : [],
      ),
  },
  search_directory: {
    status: (args) => `Looking up people${quoted(args)}`,
    sources: (_args, payload) => list(obj(payload).results).flatMap(person),
  },
  get_member_profile: {
    status: () => "Reading a profile",
    sources: (_args, payload) => person(obj(payload)),
  },
  read_page: {
    status: () => "Reading a document",
    sources: (_args, payload) => {
      const p = obj(payload);
      const id = str(p.id);
      return id ? [{ kind: "document", title: str(p.title) ?? "Document", url: pageOpenHref(str(p.kind), id) }] : [];
    },
  },
  list_project_pages: {
    status: () => "Listing project documents",
    sources: (_args, payload) =>
      flattenPages(list(obj(payload).pages)).flatMap((n) => {
        const id = str(n.id);
        return id ? [{ kind: "document" as const, title: str(n.title) ?? "Document", url: pageOpenHref(str(n.kind), id) }] : [];
      }),
  },
  get_meeting: {
    status: () => "Reading a meeting",
    sources: (_args, payload) => {
      const m = obj(payload);
      const id = str(m.meetingId);
      return id ? [{ kind: "meeting", title: str(m.title) ?? "Meeting", url: meetingUrl(id), date: str(m.startsAt) }] : [];
    },
  },
  get_meeting_transcript: {
    status: () => "Reading a transcript",
    sources: async (_args, payload) => {
      const recordingId = str(obj(payload).recordingId);
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
  },
  search_calendar: {
    status: (args) => `Searching the calendar${quoted(args)}`,
    sources: (_args, payload) =>
      list(obj(payload).local).flatMap((h) => {
        const id = str(h.id)?.replace(/^meeting:/, "");
        return id ? [{ kind: "meeting" as const, title: str(h.title) ?? "Meeting", url: meetingUrl(id), date: str(h.startIso) }] : [];
      }),
  },
  list_my_upcoming_meetings: {
    status: () => "Checking your upcoming meetings",
    filter: (payload) => {
      const p = obj(payload);
      return { ...p, meetings: list(p.meetings).filter((m) => m.source === "dali") };
    },
    sources: (_args, payload) =>
      list(obj(payload).meetings).flatMap((m) => {
        const id = str(m.id);
        return id && m.source === "dali"
          ? [{ kind: "meeting" as const, title: str(m.title) ?? "Meeting", url: meetingUrl(id), date: str(m.startsAt) }]
          : [];
      }),
  },
  list_my_tasks: {
    status: () => "Checking your tasks",
    sources: (_args, payload) => list(obj(payload).tasks).flatMap((t) => task(t, str(t.projectId))),
  },
  get_task: {
    status: () => "Reading a task",
    sources: (_args, payload) => {
      const t = obj(payload);
      return task(t, str(obj(t.project).id));
    },
  },
  list_my_projects: {
    status: () => "Checking your projects",
    sources: (_args, payload) => list(obj(payload).projects).flatMap(project),
  },
  read_help: {
    status: (args) => (str(args.slug) ? "Reading the help" : "Checking the help"),
    sources: (_args, payload) => {
      const a = obj(payload);
      const url = str(a.url);
      return url ? [{ kind: "helpArticle", title: str(a.title) ?? "Help", url }] : [];
    },
  },
  get_project_overview: {
    status: () => "Reading a project",
    sources: (_args, payload) => project(obj(payload)),
  },
};

export const ASK_TOOL_NAMES = Object.keys(ASK_TOOLS);
