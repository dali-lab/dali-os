import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { project: { findUnique: vi.fn() } } }));
vi.mock("~/lib/roles", () => ({
  currentTerm: vi.fn(),
  isCore: vi.fn(),
  isProjectMember: vi.fn(),
}));
vi.mock("~/projects/lib/task-board", () => ({ currentSprintBand: vi.fn() }));
vi.mock("~/lib/mobile-members.server", () => ({
  listMemberSummaries: vi.fn(),
  termFactsForUser: vi.fn(),
}));
const requireMobileUser = vi.fn();
vi.mock("~/lib/mobile-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/mobile-auth.server")>()),
  requireMobileUser: (...a: unknown[]) => requireMobileUser(...a),
}));

import { prisma } from "~/lib/db.server";
import { currentTerm, isCore, isProjectMember } from "~/lib/roles";
import { currentSprintBand } from "~/projects/lib/task-board";
import { listMemberSummaries, termFactsForUser } from "~/lib/mobile-members.server";
import { loader } from "../api.mobile.projects.$id";

const m = prisma as any;
const DAY = 86_400_000;
const start = Date.UTC(2026, 8, 21);

const task = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Task ${id}`,
  description: null,
  status: "Todo",
  startsAt: null,
  dueAt: null,
  epicId: null,
  githubIssueNumber: null,
  domain: null,
  assignees: [],
  _count: { comments: 0, files: 0 },
  ...over,
});
const baseProject = (over: Record<string, unknown> = {}) => ({
  id: "pr1",
  name: "Alpha",
  status: "Active",
  projectTerms: [{ term: { code: "26F", startDate: new Date(start), endDate: new Date(start + 70 * DAY), sortKey: 2 } }],
  domains: [],
  assignments: [
    { userId: "u1", termId: "t26f", domain: { displayName: "Fullstack Dev" } },
    { userId: "u2", termId: "t26f", domain: { displayName: "Design" } },
    { userId: "u3", termId: "t25s", domain: { displayName: "Fullstack Dev" } },
  ],
  epics: [],
  tasks: [],
  ...over,
});

const load = () =>
  loader({ request: new Request("https://os.example/api/mobile/projects/pr1"), params: { id: "pr1" } } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileUser.mockResolvedValue({ ok: true, userId: "u1" });
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(isProjectMember).mockResolvedValue(true);
  vi.mocked(currentTerm).mockResolvedValue({ id: "t26f", code: "26F" } as never);
  vi.mocked(currentSprintBand).mockReturnValue(null);
  vi.mocked(listMemberSummaries).mockResolvedValue([{ id: "u1" }] as never);
  vi.mocked(termFactsForUser).mockResolvedValue({ coreLeadTitle: "Delivery Lead", domainLeadOf: [] } as never);
  m.project.findUnique.mockResolvedValue(baseProject());
});

describe("GET /api/mobile/projects/:id — access", () => {
  it("returns the auth guard's response", async () => {
    requireMobileUser.mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) });
    expect((await load()).status).toBe(401);
    expect(m.project.findUnique).not.toHaveBeenCalled();
  });

  it("404s (not 403) a non-Core non-member so existence is not revealed", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(false);
    const res = await load();
    expect(res.status).toBe(404);
    expect(m.project.findUnique).not.toHaveBeenCalled();
  });

  it("lets Core view a project they are not on", async () => {
    vi.mocked(isProjectMember).mockResolvedValue(false);
    vi.mocked(isCore).mockResolvedValue(true);
    expect((await load()).status).toBe(200);
  });

  it("404s a project that does not exist", async () => {
    m.project.findUnique.mockResolvedValue(null);
    expect((await load()).status).toBe(404);
  });

  it("excludes archived tasks from the query", async () => {
    await load();
    expect(m.project.findUnique.mock.calls[0][0].select.tasks.where).toEqual({ archivedAt: null });
  });
});

describe("GET /api/mobile/projects/:id — response shape", () => {
  it("returns project, members, epics and tasks", async () => {
    m.project.findUnique.mockResolvedValue(
      baseProject({
        epics: [
          { id: "e1", title: "Launch", startsAt: new Date("2026-09-21T00:00:00Z"), endsAt: null },
        ],
        tasks: [
          task("k1", {
            status: "Done",
            description: "Ship it",
            startsAt: new Date("2026-09-22T00:00:00Z"),
            dueAt: new Date("2026-09-30T00:00:00Z"),
            epicId: "e1",
            githubIssueNumber: 42,
            domain: { displayName: "Design" },
            assignees: [{ userId: "u2" }],
            _count: { comments: 3, files: 1 },
          }),
          task("k2", { status: "Cancelled" }),
          task("k3"),
        ],
      }),
    );
    vi.mocked(listMemberSummaries).mockResolvedValue([{ id: "u1" }, { id: "u2" }] as never);

    const body = await (await load()).json();
    expect(body).toEqual({
      project: {
        id: "pr1",
        name: "Alpha",
        status: "Active",
        terms: ["26F"],
        myRole: "Fullstack Dev",
        myLeadRole: "Delivery Lead",
        roles: ["Fullstack Dev", "Design"],
        memberIds: ["u1", "u2"],
        sprint: null,
        doneCount: 1,
        totalCount: 2,
      },
      members: [{ id: "u1" }, { id: "u2" }],
      epics: [{ id: "e1", name: "Launch", startDate: "2026-09-21T00:00:00.000Z", endDate: null }],
      tasks: [
        {
          id: "k1",
          title: "Task k1",
          description: "Ship it",
          status: "Done",
          assigneeIds: ["u2"],
          startDate: "2026-09-22T00:00:00.000Z",
          dueDate: "2026-09-30T00:00:00.000Z",
          role: "Design",
          epicId: "e1",
          commentCount: 3,
          attachmentCount: 1,
          linkRef: "42",
        },
        expect.objectContaining({ id: "k2", status: "Cancelled", assigneeIds: [], startDate: null, dueDate: null, role: null, linkRef: null }),
        expect.objectContaining({ id: "k3", commentCount: 0, attachmentCount: 0 }),
      ],
    });
  });

  it("staffs from the current term's assignments, loading summaries for them plus task assignees", async () => {
    m.project.findUnique.mockResolvedValue(baseProject({ tasks: [task("k1", { assignees: [{ userId: "u9" }] })] }));
    await load();
    expect(listMemberSummaries).toHaveBeenCalledWith(["u1", "u2", "u9"]);
    expect(termFactsForUser).toHaveBeenCalledWith("u1", "26F");
  });

  it("falls back to all assignments when nobody is staffed this term, with no role for the viewer", async () => {
    vi.mocked(currentTerm).mockResolvedValue({ id: "t-new", code: "27W" } as never);
    const body = await (await load()).json();
    expect(body.project.memberIds).toEqual(["u1", "u2", "u3"]);
    expect(body.project.myRole).toBeNull();
  });

  it("copes with no current term", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);
    vi.mocked(termFactsForUser).mockResolvedValue(null as never);
    const body = await (await load()).json();
    expect(body.project.myRole).toBeNull();
    expect(body.project.myLeadRole).toBeNull();
    expect(termFactsForUser).toHaveBeenCalledWith("u1", null);
  });

  it("prefers the project's own domains for roles", async () => {
    m.project.findUnique.mockResolvedValue(baseProject({ domains: [{ domain: { displayName: "Backend" } }] }));
    expect((await (await load()).json()).project.roles).toEqual(["Backend"]);
  });

  it("orders terms by sortKey", async () => {
    const t = (code: string, sortKey: number) => ({ term: { code, startDate: new Date(start), endDate: new Date(start + DAY), sortKey } });
    m.project.findUnique.mockResolvedValue(baseProject({ projectTerms: [t("26F", 2), t("26S", 1)] }));
    expect((await (await load()).json()).project.terms).toEqual(["26S", "26F"]);
  });

  it("reports the current sprint number and its start and end-of-day dates", async () => {
    vi.mocked(currentSprintBand).mockReturnValue({ key: start, end: start + 13 * DAY, label: "Sprint 4" } as never);
    const { sprint } = (await (await load()).json()).project;
    expect(sprint).toEqual({
      number: 4,
      startDate: new Date(start).toISOString(),
      endDate: new Date(start + 14 * DAY - 1).toISOString(),
    });
  });

  it("has no sprint when the band label carries no number", async () => {
    vi.mocked(currentSprintBand).mockReturnValue({ key: start, end: start, label: "Break" } as never);
    expect((await (await load()).json()).project.sprint).toBeNull();
  });
});
