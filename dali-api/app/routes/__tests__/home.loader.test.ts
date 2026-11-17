import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { user: { findMany: vi.fn(async () => []) } } }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(async () => false),
  redirectPartnerToPortal: vi.fn(async () => null),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/read-only-roles.server", () => ({ readOnlyRoles: vi.fn(async () => ({ isAlumni: true })) }));
vi.mock("~/lib/shell-user.server", () => ({ loadShellUser: vi.fn(async () => ({ timeZone: "America/New_York", birthday: null })) }));
vi.mock("~/lib/tasks.server", () => ({ listMyProjectTasks: vi.fn(async () => []), listOpenTasks: vi.fn(async () => []) }));
vi.mock("~/lib/roles", () => ({ currentTermStrict: vi.fn(async () => null), getUserRoles: vi.fn(async () => ({})) }));
vi.mock("~/components/CommandPalette", () => ({ resultIcon: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn(async () => false) }));

import { requireAuth } from "~/lib/auth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { readOnlyRoles } from "~/lib/read-only-roles.server";
import { currentTermStrict } from "~/lib/roles";
import { loader } from "../home";

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
});

describe("home loader", () => {
  it("gives alumni the home page instead of sending them to Community", async () => {
    const res = await loader({ request: new Request("http://localhost/"), params: {}, context: {} } as never);
    expect(res).not.toBeInstanceOf(Response);
    expect(res).toMatchObject({ tasks: [], birthdays: [], week: null });
  });

  it("shows alumni the Baker tower home when the flag is on", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValueOnce(true);
    const res = await loader({ request: new Request("http://localhost/"), params: {}, context: {} } as never);
    expect(res).toMatchObject({ alumniHome: true });
    expect(isFeatureEnabled).toHaveBeenCalledWith("alumni-home", "u1", { isAlumni: true }, expect.any(Request));
  });

  it("keeps alumni on the usual home while the flag is off", async () => {
    const res = await loader({ request: new Request("http://localhost/"), params: {}, context: {} } as never);
    expect(res).toMatchObject({ alumniHome: false });
  });

  it("never shows the Baker tower home to members, even with the flag on", async () => {
    vi.mocked(readOnlyRoles).mockResolvedValueOnce({ isAlumni: false } as never);
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    const res = await loader({ request: new Request("http://localhost/"), params: {}, context: {} } as never);
    expect(res).toMatchObject({ alumniHome: false });
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
  });

  it("names the term with the week for the hero's detail line", async () => {
    vi.mocked(currentTermStrict).mockResolvedValueOnce({
      code: "26F",
      startDate: new Date(Date.UTC(2026, 8, 14)),
    } as never);
    const res = await loader({ request: new Request("http://localhost/"), params: {}, context: {} } as never);
    expect(res).toMatchObject({ week: { term: "26F" } });
  });

  describe("week badge", () => {
    const fall = { code: "26F", startDate: new Date(Date.UTC(2026, 8, 14)) };
    const load = (url: string) =>
      loader({ request: new Request(url), params: {}, context: {} } as never);

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
      vi.mocked(currentTermStrict).mockResolvedValueOnce(fall as never);
    });
    afterEach(() => vi.useRealTimers());

    it("shows this week without a preview", async () => {
      expect(await load("http://localhost/")).toMatchObject({
        background: "bug-hunt",
        week: { index: 9, dates: "Nov 9 – 13" },
      });
    });

    it("shows the previewed week's number and dates with its title", async () => {
      expect(await load("http://localhost/?background=build")).toMatchObject({
        background: "build",
        milestoneTitle: "Build",
        week: { index: 5, dates: "Oct 12 – 16" },
      });
    });

    it("drops the badge for a previewed week from before the term", async () => {
      expect(await load("http://localhost/?background=deep-space")).toMatchObject({
        background: "deep-space",
        week: null,
      });
    });

    it("ignores an unknown preview", async () => {
      expect(await load("http://localhost/?background=nope")).toMatchObject({
        background: "bug-hunt",
        week: { index: 9 },
      });
    });
  });
});
