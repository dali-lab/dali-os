import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import { ASK_SEARCH_CATEGORIES, ASK_TOOLS, ASK_TOOL_NAMES, type AskToolName } from "../tools.server";
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

type Result<R extends (...a: never[]) => Promise<unknown>> = Awaited<ReturnType<R>>;
type DeepPartial<T> = T extends (infer U)[] ? DeepPartial<U>[] : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

type Payloads = {
  search: Result<typeof runMcpSearch>;
  search_directory: Result<typeof runSearchDirectory>;
  get_member_profile: Result<typeof runGetMemberProfile>;
  read_page: Result<typeof runReadPage>;
  list_project_pages: Result<typeof runListProjectPages>;
  get_meeting: Result<typeof runGetMeeting>;
  get_meeting_transcript: Result<typeof runGetMeetingTranscript>;
  search_calendar: Result<typeof runSearchCalendar>;
  list_my_upcoming_meetings: Result<typeof runListMyUpcomingMeetings>;
  list_my_tasks: Result<typeof runListMyTasks>;
  get_task: Result<typeof runGetTask>;
  list_my_projects: Result<typeof runListMyProjects>;
  read_help: Result<typeof runReadHelp>;
  get_project_overview: Result<typeof runGetProjectOverview>;
};

const mockPrisma = prisma as unknown as {
  meetingRecording: { findUnique: ReturnType<typeof vi.fn> };
};

const sources = <K extends AskToolName & keyof Payloads>(
  name: K,
  payload: DeepPartial<Payloads[K]>,
  args: Record<string, unknown> = {},
) => ASK_TOOLS[name].sources(args, payload);

beforeEach(() => vi.clearAllMocks());

describe("ASK_TOOLS", () => {
  it("is the read-only allowlist from the spec", () => {
    expect([...ASK_TOOL_NAMES].sort()).toEqual(
      [
        "search",
        "search_directory",
        "read_page",
        "list_project_pages",
        "get_meeting",
        "get_meeting_transcript",
        "search_calendar",
        "list_my_upcoming_meetings",
        "list_my_tasks",
        "get_task",
        "list_my_projects",
        "get_project_overview",
        "get_member_profile",
        "read_help",
      ].sort(),
    );
  });

  it("describes each lookup in plain words", () => {
    expect(ASK_TOOLS.search.status({ q: "launch date" })).toBe('Searching for "launch date"');
    expect(ASK_TOOLS.search.status({})).toBe("Searching");
    expect(ASK_TOOLS.read_page.status({ pageId: "p1" })).toBe("Reading a document");
  });
});

describe("search", () => {
  it("leaves out hiring, partner and agreement categories", () => {
    for (const c of ["application", "partnerApplication", "cycle", "rubric", "challenge", "confidentialityAgreement", "partner", "partnerContact"]) {
      expect(ASK_SEARCH_CATEGORIES as readonly string[]).not.toContain(c);
    }
  });

  it("refuses an excluded category before the search runs", () => {
    expect(ASK_TOOLS.search.guard!({ q: "x", category: "application" })).toMatch(/isn't available here/);
    expect(ASK_TOOLS.search.guard!({ q: "x", category: "document" })).toBeNull();
    expect(ASK_TOOLS.search.guard!({ q: "x" })).toBeNull();
  });

  it("filters excluded results out of what the model sees", () => {
    const filtered = ASK_TOOLS.search.filter!({
      results: [
        { type: "document", id: "p1", title: "Plan", url: "/documents/p1" },
        { type: "application", id: "a1", title: "Applicant", url: "/hiring/applications/a1" },
        { type: "partnerApplication", id: "pa1", title: "Partner app", url: "/core/partners/applications/pa1" },
      ],
      categoriesWithMore: ["document", "application"],
    }) as { results: { type: string }[]; categoriesWithMore: string[] };
    expect(filtered.results.map((r) => r.type)).toEqual(["document"]);
    expect(filtered.categoriesWithMore).toEqual(["document"]);
  });

  it("keeps a paged category result's page info", () => {
    const filtered = ASK_TOOLS.search.filter!({ results: [], page: { hasMore: true } }) as Record<string, unknown>;
    expect(filtered).toEqual({ results: [], page: { hasMore: true } });
  });

  it("cites each allowed result by its own url", async () => {
    expect(
      await sources("search", {
        results: [
          { type: "document", id: "p1", title: "Plan", url: "/documents/p1", subtitle: "Harbor" },
          { type: "application", id: "a1", title: "Applicant", url: "/hiring/applications/a1" },
        ],
      }),
    ).toEqual([{ kind: "document", title: "Plan", url: "/documents/p1", detail: "Harbor" }]);
  });
});

describe("help", () => {
  it("says whether it's listing or reading", () => {
    expect(ASK_TOOLS.read_help.status({})).toBe("Checking the help");
    expect(ASK_TOOLS.read_help.status({ slug: "rooms" })).toBe("Reading the help");
  });

  it("cites an article it read, and nothing for the list", async () => {
    expect(await sources("read_help", { slug: "rooms", title: "Booking rooms", url: "/help/articles/rooms", body: "x" })).toEqual([
      { kind: "helpArticle", title: "Booking rooms", url: "/help/articles/rooms" },
    ]);
    expect(await sources("read_help", { articles: [{ slug: "rooms", title: "Booking rooms", summary: "s" }] })).toEqual([]);
  });

  it("cites the in-site pages an article links to, so the answer can link to them", async () => {
    const body =
      "Book from [Rooms](/rooms) or the [Calendar](/calendar?view=week). See [Attendance](/help/articles/attendance). " +
      "Ask [Google](https://google.com) or write [here](mailto:a@b.c).";
    expect(await sources("read_help", { slug: "rooms", title: "Booking rooms", url: "/help/articles/rooms", body })).toEqual([
      { kind: "helpArticle", title: "Booking rooms", url: "/help/articles/rooms" },
      { kind: "page", title: "Rooms", url: "/rooms" },
      { kind: "page", title: "Calendar", url: "/calendar?view=week" },
      { kind: "helpArticle", title: "Attendance", url: "/help/articles/attendance" },
    ]);
  });
});

describe("people and projects", () => {
  it("cites directory results and profiles as member pages", async () => {
    expect(await sources("search_directory", { results: [{ id: "u2", firstName: "Grace", lastName: "Hopper" }] })).toEqual([
      { kind: "person", title: "Grace Hopper", url: "/members/u2" },
    ]);
    expect(await sources("get_member_profile", { id: "u3", firstName: "Ada", lastName: null })).toEqual([
      { kind: "person", title: "Ada", url: "/members/u3" },
    ]);
  });

  it("cites projects", async () => {
    expect(await sources("list_my_projects", { projects: [{ id: "pr1", name: "Harbor" }] })).toEqual([
      { kind: "project", title: "Harbor", url: "/projects/pr1" },
    ]);
    expect(await sources("get_project_overview", { id: "pr2", name: "Lumen" })).toEqual([
      { kind: "project", title: "Lumen", url: "/projects/pr2" },
    ]);
  });

  it("cites tasks on their project board", async () => {
    expect(
      await sources("list_my_tasks", {
        tasks: [{ id: "t1", title: "Ship v2", projectId: "pr1", dueAt: "2026-11-10T00:00:00.000Z" }],
      }),
    ).toEqual([
      { kind: "task", title: "Ship v2", url: "/projects/pr1?tab=board&task=t1", date: "2026-11-10T00:00:00.000Z" },
    ]);
    expect(await sources("get_task", { id: "t2", title: "Fix login", dueAt: null, project: { id: "pr2" } })).toEqual([
      { kind: "task", title: "Fix login", url: "/projects/pr2?tab=board&task=t2", date: null },
    ]);
  });

  it("skips records without an id", async () => {
    expect(await sources("list_my_projects", { projects: [{ name: "No id" }] })).toEqual([]);
    expect(await sources("read_page", { title: "No id" })).toEqual([]);
  });
});

describe("documents", () => {
  it("cites a page where it opens", async () => {
    expect(await sources("read_page", { id: "p1", title: "Plan", kind: "Document" })).toEqual([
      { kind: "document", title: "Plan", url: "/documents/p1" },
    ]);
    expect((await sources("read_page", { id: "w1", title: "Board", kind: "Whiteboard" }))[0].url).toBe("/whiteboard/w1");
  });

  it("cites every page in a project tree, nested ones included", async () => {
    const out = await sources("list_project_pages", {
      pages: [
        { id: "p1", title: "Overview", kind: "Document", children: [{ id: "p2", title: "Notes", kind: "Document", children: [] }] },
        { id: "d1", title: "Deck", kind: "Slides", children: [] },
      ],
    });
    expect(out.map((s) => s.url)).toEqual(["/documents/p1", "/documents/p2", "/slides/d1"]);
  });
});

describe("meetings", () => {
  it("cites a meeting with its start time", async () => {
    expect(await sources("get_meeting", { meetingId: "m1", title: "Partner sync", startsAt: "2026-10-30T15:00:00.000Z" })).toEqual([
      { kind: "meeting", title: "Partner sync", url: "/calendar/meeting/m1", date: "2026-10-30T15:00:00.000Z" },
    ]);
  });

  it("cites DALI calendar hits but not Google events, which have no page here", async () => {
    expect(
      await sources("search_calendar", {
        local: [{ id: "meeting:m2", title: "Retro", startIso: "2026-10-31T18:00:00.000Z" }],
        google: [{ id: "google:c:e:1", title: "Dentist" }],
      }),
    ).toEqual([{ kind: "meeting", title: "Retro", url: "/calendar/meeting/m2", date: "2026-10-31T18:00:00.000Z" }]);
  });

  it("drops interviews from upcoming meetings", async () => {
    const payload = {
      meetings: [
        { id: "m1", title: "Standup", startsAt: "2026-11-05T14:00:00.000Z", source: "dali" },
        { id: "i1", title: "Interview: Applicant", startsAt: "2026-11-05T16:00:00.000Z", source: "interview" },
      ],
    };
    const filtered = ASK_TOOLS.list_my_upcoming_meetings.filter!(payload) as typeof payload;
    expect(filtered.meetings.map((m) => m.id)).toEqual(["m1"]);
    expect((await sources("list_my_upcoming_meetings", payload)).map((s) => s.url)).toEqual(["/calendar/meeting/m1"]);
  });

  it("cites a transcript on its note, opened to the recording", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue({
      documentName: "doc:pg9:body",
      createdAt: new Date("2026-10-30T15:05:00.000Z"),
      scheduledMeeting: { title: "Partner sync" },
    });
    expect(await sources("get_meeting_transcript", { recordingId: "r1", lines: [] })).toEqual([
      {
        kind: "transcript",
        title: "Partner sync",
        url: "/documents/pg9?transcript=r1",
        date: "2026-10-30T15:05:00.000Z",
        detail: "Transcript",
      },
    ]);
    expect(mockPrisma.meetingRecording.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1" } }),
    );
  });

  it("gives a transcript with no note page no source", async () => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue({
      documentName: "interview:i1:body",
      createdAt: new Date(),
      scheduledMeeting: null,
    });
    expect(await sources("get_meeting_transcript", { recordingId: "r2" })).toEqual([]);
    mockPrisma.meetingRecording.findUnique.mockResolvedValue(null);
    expect(await sources("get_meeting_transcript", { recordingId: "r3" })).toEqual([]);
    expect(await sources("get_meeting_transcript", {})).toEqual([]);
  });
});

describe("every Ask tool cites from a realistic payload", () => {
  const realistic: { [K in keyof Payloads]: { payload: DeepPartial<Payloads[K]>; kinds: string[] } } = {
    search: {
      payload: { results: [{ type: "project", id: "pr1", title: "Harbor", url: "/projects/pr1" }], categoriesWithMore: [] },
      kinds: ["project"],
    },
    search_directory: {
      payload: { results: [{ id: "u1", firstName: "Ada", lastName: "Lovelace", tier: "member", domains: [], currentTermRoles: [] }] },
      kinds: ["person"],
    },
    get_member_profile: { payload: { id: "u1", firstName: "Ada", lastName: "Lovelace" }, kinds: ["person"] },
    read_page: { payload: { id: "p1", title: "Plan", kind: "Document", workspaceType: "Project" }, kinds: ["document"] },
    list_project_pages: {
      payload: { pages: [{ id: "p1", title: "Overview", kind: "Document", children: [] }] },
      kinds: ["document"],
    },
    get_meeting: { payload: { meetingId: "m1", title: "Sync", startsAt: "2026-11-05T14:00:00.000Z" }, kinds: ["meeting"] },
    get_meeting_transcript: { payload: { recordingId: "r1", status: "Done", lines: [] }, kinds: ["transcript"] },
    search_calendar: {
      payload: { local: [{ id: "meeting:m1", source: "meeting", title: "Retro", startIso: "2026-11-06T18:00:00.000Z" }], google: [] },
      kinds: ["meeting"],
    },
    list_my_upcoming_meetings: {
      payload: { meetings: [{ id: "m1", title: "Standup", startsAt: "2026-11-05T14:00:00.000Z", source: "dali" }] },
      kinds: ["meeting"],
    },
    list_my_tasks: {
      payload: { tasks: [{ id: "t1", title: "Ship", projectId: "pr1", dueAt: null }] },
      kinds: ["task"],
    },
    get_task: { payload: { id: "t1", title: "Ship", dueAt: null, project: { id: "pr1", name: "Harbor" } }, kinds: ["task"] },
    list_my_projects: { payload: { projects: [{ id: "pr1", name: "Harbor" }] }, kinds: ["project"] },
    read_help: { payload: { slug: "rooms", title: "Rooms", url: "/help/articles/rooms", body: "" }, kinds: ["helpArticle"] },
    get_project_overview: { payload: { id: "pr1", name: "Harbor" }, kinds: ["project"] },
  };

  it("covers every tool", () => {
    expect(Object.keys(realistic).sort()).toEqual([...ASK_TOOL_NAMES].sort());
  });

  it.each(Object.entries(realistic))("%s yields citations", async (name, { payload, kinds }) => {
    mockPrisma.meetingRecording.findUnique.mockResolvedValue({
      documentName: "doc:pg9:body",
      createdAt: new Date("2026-10-30T15:05:00.000Z"),
      scheduledMeeting: { title: "Partner sync" },
    });
    const out = await ASK_TOOLS[name].sources({}, payload);
    expect(out.map((s) => s.kind)).toEqual(kinds);
    expect(out.every((s) => s.url.startsWith("/"))).toBe(true);
  });
});
