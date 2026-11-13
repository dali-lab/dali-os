import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/login-next", () => ({
  redirectToLogin: () => new Response(null, { status: 302, headers: { Location: "/login" } }),
}));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/education/lib/access.server", () => ({ redirectDartmouthToPortal: vi.fn() }));
vi.mock("~/education/lib/taskboard/taskboard.server", () => ({ loadBoard: vi.fn() }));
vi.mock("~/education/lib/taskboard/actions.server", () => ({
  handleTaskboardAction: vi.fn(),
  resultId: (r: { ok: boolean; value?: { id?: string } }) => (r.ok ? r.value?.id : undefined),
}));
vi.mock("~/education/components/taskboard/TaskboardPage", () => ({ TaskboardPage: () => null }));

import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { redirectDartmouthToPortal } from "~/education/lib/access.server";
import { loadBoard } from "~/education/lib/taskboard/taskboard.server";
import { handleTaskboardAction } from "~/education/lib/taskboard/actions.server";
import { action, loader } from "../education.taskboard";

const board = {
  termWeeks: 10,
  periods: [{ id: "f", name: "Fall", shortName: "26F", kind: "Term", startDate: "2026-09-13", weekCount: 10 }],
  milestones: [],
  tasks: [],
  members: [],
};

const call = (fn: unknown, url: string, init?: RequestInit) =>
  (fn as (a: { request: Request }) => Promise<unknown>)({ request: new Request(url, init) });
const asLoader = (url = "http://localhost/education/taskboard") => call(loader, url);
const asAction = (form: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(form)) body.set(k, v);
  return call(action, "http://localhost/education/taskboard", { method: "POST", body });
};
const location = (r: unknown) => (r as Response).headers.get("Location");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "me", type: "member" } } as never);
  vi.mocked(getUserRoles).mockResolvedValue({ isCore: true } as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(redirectDartmouthToPortal).mockReturnValue(null as never);
  vi.mocked(loadBoard).mockResolvedValue(board as never);
});

describe("loader", () => {
  it("sends signed-out visitors to login", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    expect(location(await asLoader())).toBe("/login");
    expect(loadBoard).not.toHaveBeenCalled();
  });

  it("sends non-members to the portal", async () => {
    vi.mocked(redirectDartmouthToPortal).mockReturnValue(new Response(null, { status: 302, headers: { Location: "/portal" } }) as never);
    expect(location(await asLoader())).toBe("/portal");
    expect(loadBoard).not.toHaveBeenCalled();
  });

  it("sends members who are not Core back to Education", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({ isCore: false } as never);
    expect(location(await asLoader())).toBe("/education");
    expect(loadBoard).not.toHaveBeenCalled();
  });

  it("sends Core members back to Education while the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect(location(await asLoader())).toBe("/education");
    expect(isFeatureEnabled).toHaveBeenCalledWith("education-taskboard", "me", { isCore: true }, expect.any(Request));
    expect(loadBoard).not.toHaveBeenCalled();
  });

  it("returns the board with the current week and the signed-in user", async () => {
    const data = (await asLoader()) as { periods: unknown[]; userId: string; today: string; viewed: unknown };
    expect(data.userId).toBe("me");
    expect(data.periods).toHaveLength(1);
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.viewed).not.toBeUndefined();
  });

  it("honors a valid period and week in the URL", async () => {
    const data = (await asLoader("http://localhost/education/taskboard?period=f&week=3")) as { viewed: unknown };
    expect(data.viewed).toEqual({ periodId: "f", week: 3 });
  });

  it("ignores an invalid week in the URL", async () => {
    const data = (await asLoader("http://localhost/education/taskboard?period=f&week=99")) as { viewed: { week: number } | null };
    expect(data.viewed?.week).not.toBe(99);
  });
});

describe("action", () => {
  it("returns the auth response when signed out", async () => {
    const response = new Response("nope", { status: 401 });
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response } as never);
    expect(await asAction({ intent: "task-delete" })).toBe(response);
    expect(handleTaskboardAction).not.toHaveBeenCalled();
  });

  it("forbids non-Core members and a switched-off flag", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({ isCore: false } as never);
    expect(((await asAction({ intent: "task-delete" })) as Response).status).toBe(403);
    vi.mocked(getUserRoles).mockResolvedValue({ isCore: true } as never);
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect(((await asAction({ intent: "task-delete" })) as Response).status).toBe(403);
    expect(handleTaskboardAction).not.toHaveBeenCalled();
  });

  it("passes the form and the actor through and returns the created id", async () => {
    vi.mocked(handleTaskboardAction).mockResolvedValue({ ok: true, value: { id: "new" } });
    expect(await asAction({ intent: "milestone-save", name: "x" })).toEqual({ ok: true, id: "new" });
    const [form, actor] = vi.mocked(handleTaskboardAction).mock.calls[0];
    expect(actor).toBe("me");
    expect((form as FormData).get("intent")).toBe("milestone-save");
  });

  it("turns a failed result into a JSON error with its status", async () => {
    vi.mocked(handleTaskboardAction).mockResolvedValue({ ok: false, status: 409, error: "Move tasks first." });
    const response = (await asAction({ intent: "period-delete", id: "p" })) as Response;
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Move tasks first." });
  });
});
