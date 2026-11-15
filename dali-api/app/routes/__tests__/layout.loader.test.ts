import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectPartnerToPortal: vi.fn(),
  impersonationAllowsWrites: vi.fn(() => false),
  isImpersonating: vi.fn(() => false),
  isNonMember: vi.fn(),
}));
vi.mock("~/lib/betterauth-upgrade.server", () => ({ maybeUpgradeLegacyToBetterAuth: vi.fn() }));
vi.mock("~/lib/login-next", () => ({
  redirectToLogin: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/login" } })),
}));
vi.mock("~/hiring/lib/cycles", () => ({ getActiveCycles: vi.fn() }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn() }));
vi.mock("~/lib/shell-user.server", () => ({ loadShellUser: vi.fn() }));
vi.mock("~/lib/layout-reads.server", () => ({
  layoutAppGate: vi.fn(),
  layoutFavorites: vi.fn(),
  layoutFormGate: vi.fn(),
  layoutHasLiveCycleRole: vi.fn(),
  layoutHasUnseenReleaseNotes: vi.fn(),
  layoutIsAnyCycleReviewer: vi.fn(),
  layoutIsLabMentor: vi.fn(),
  layoutIsLiveInterviewer: vi.fn(),
  layoutIsNewMember: vi.fn(),
  layoutRoles: vi.fn(),
}));
vi.mock("~/lib/feature-flags.server", () => ({ resolveFeatureFlags: vi.fn() }));
vi.mock("~/lib/activities.server", () => ({ resolveActiveActivitiesForUser: vi.fn() }));
vi.mock("~/lib/server-timing", () => ({
  timed: (_request: Request, _name: string, run: () => unknown) => run(),
}));
vi.mock("~/lib/public-doc.server", () => ({ publicDocRedirectForPath: vi.fn() }));
vi.mock("~/lib/impersonation-restore.server", () => ({ redirectRestoringAdmin: vi.fn() }));

import { isNonMember, redirectPartnerToPortal, requireAuth } from "~/lib/auth";
import { maybeUpgradeLegacyToBetterAuth } from "~/lib/betterauth-upgrade.server";
import { getActiveCycles } from "~/hiring/lib/cycles";
import { layoutAppGate, layoutFavorites, layoutFormGate, layoutRoles } from "~/lib/layout-reads.server";
import { loadShellUser } from "~/lib/shell-user.server";
import { resolveFeatureFlags } from "~/lib/feature-flags.server";
import { resolveActiveActivitiesForUser } from "~/lib/activities.server";
import { publicDocRedirectForPath } from "~/lib/public-doc.server";
import { redirectToLogin } from "~/lib/login-next";
import { redirectRestoringAdmin } from "~/lib/impersonation-restore.server";
import { isImpersonating } from "~/lib/auth";
import { encodeTabsSnapshot } from "~/lib/desktop-tabs-pref";
import { loader } from "~/routes/layout";

const auth = { ok: true, user: { sub: "ada", email: "ada@example.edu" } };
const to = (location: string, init?: ResponseInit) =>
  new Response(null, { ...init, status: 302, headers: { Location: location, ...init?.headers } });

const run = (path = "/projects?view=grid") => {
  const request = new Request(`https://os.test${path}`);
  return { request, result: loader({ request } as never) as Promise<Response> };
};

const location = (response: Response) => response.headers.get("Location");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(auth as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(redirectPartnerToPortal).mockResolvedValue(null as never);
  vi.mocked(maybeUpgradeLegacyToBetterAuth).mockResolvedValue(null as never);
  vi.mocked(publicDocRedirectForPath).mockResolvedValue(null as never);
  vi.mocked(redirectRestoringAdmin).mockResolvedValue(null);
  vi.mocked(isImpersonating).mockReturnValue(false);
  vi.mocked(getActiveCycles).mockResolvedValue([] as never);
  vi.mocked(layoutFavorites).mockResolvedValue({} as never);
  vi.mocked(loadShellUser).mockResolvedValue({ photoUrl: null } as never);
  vi.mocked(layoutRoles).mockResolvedValue({ isLabMember: true } as never);
  vi.mocked(layoutFormGate).mockResolvedValue(null as never);
  vi.mocked(layoutAppGate).mockResolvedValue({ bindingId: "b1" } as never);
});

describe("layout loader gate order", () => {
  it("restores the admin in place when an impersonation session has lapsed", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    vi.mocked(redirectRestoringAdmin).mockResolvedValue(to("/projects?view=grid"));
    const { request, result } = run();
    expect(location(await result)).toBe("/projects?view=grid");
    expect(redirectRestoringAdmin).toHaveBeenCalledWith(request, "/projects?view=grid");
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it("prefers a public document over restoring an admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    vi.mocked(publicDocRedirectForPath).mockResolvedValue(to("/d/public") as never);
    const { result } = run();
    expect(location(await result)).toBe("/d/public");
    expect(redirectRestoringAdmin).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to login without running the shell reads", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const { result } = run();
    expect(location(await result)).toBe("/login");
    expect(redirectToLogin).toHaveBeenCalledOnce();
    expect(isNonMember).not.toHaveBeenCalled();
    expect(layoutRoles).not.toHaveBeenCalled();
  });

  it("runs the non-member check in the shell wave instead of waiting for it", async () => {
    let finish!: (nonMember: boolean) => void;
    vi.mocked(isNonMember).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { request, result } = run();
    await vi.waitFor(() => expect(isNonMember).toHaveBeenCalledWith(auth, request));
    await vi.waitFor(() => expect(layoutRoles).toHaveBeenCalledWith("ada", request));
    expect(layoutFavorites).toHaveBeenCalled();
    expect(loadShellUser).toHaveBeenCalled();
    finish(true);
    expect(location(await result)).toBe("/portal");
  });

  it("sends a non-member to /portal", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);
    expect(location(await run().result)).toBe("/portal");
  });

  it("sends a non-member to a public doc over /portal", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);
    vi.mocked(publicDocRedirectForPath).mockResolvedValue(to("/d/public") as never);
    expect(location(await run("/documents/p1").result)).toBe("/d/public");
  });

  it("never gives a non-member the session upgrade", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);
    vi.mocked(maybeUpgradeLegacyToBetterAuth).mockResolvedValue(new Headers({ "Set-Cookie": "s=1" }) as never);
    expect(location(await run().result)).toBe("/portal");
    expect(maybeUpgradeLegacyToBetterAuth).not.toHaveBeenCalled();
  });

  it("applies the non-member redirect ahead of the partner redirect", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);
    vi.mocked(redirectPartnerToPortal).mockResolvedValue(to("/partner") as never);
    expect(location(await run().result)).toBe("/portal");
  });

  it("reloads the same URL with the upgrade cookie, ahead of the partner redirect", async () => {
    vi.mocked(maybeUpgradeLegacyToBetterAuth).mockResolvedValue(new Headers({ "Set-Cookie": "s=1" }) as never);
    vi.mocked(redirectPartnerToPortal).mockResolvedValue(to("/partner") as never);
    const response = await run().result;
    expect(location(response)).toBe("/projects?view=grid");
    expect(response.headers.get("Set-Cookie")).toBe("s=1");
  });

  it("sends a partner to the partner portal", async () => {
    vi.mocked(redirectPartnerToPortal).mockResolvedValue(to("/partner") as never);
    expect(location(await run().result)).toBe("/partner");
  });

  it("sends a partner to a public doc over the partner portal", async () => {
    vi.mocked(redirectPartnerToPortal).mockResolvedValue(to("/partner") as never);
    vi.mocked(publicDocRedirectForPath).mockResolvedValue(to("/d/public") as never);
    expect(location(await run("/documents/p1").result)).toBe("/d/public");
  });

  it("lets a member through to the next gate", async () => {
    const response = await run().result;
    expect(location(response)).toBe(`/sign/b1?next=${encodeURIComponent("/projects?view=grid")}`);
  });

  describe("external instructors", () => {
    beforeEach(() => {
      vi.mocked(isNonMember).mockResolvedValue(true);
      vi.mocked(layoutRoles).mockResolvedValue({ isLabMember: false, isInstructor: true } as never);
      vi.mocked(loadShellUser).mockResolvedValue({ photoUrl: null, calendarLinks: [] } as never);
      vi.mocked(resolveFeatureFlags).mockResolvedValue({} as never);
      vi.mocked(resolveActiveActivitiesForUser).mockResolvedValue([] as never);
    });

    it.each(["/education/manage/o1", "/education/manage/assignments/a1", "/education/offerings"])(
      "reach %s in the instructor chrome",
      async (path) => {
        const data = (await run(path).result) as unknown as { instructorChrome: boolean };
        expect(data).not.toBeInstanceOf(Response);
        expect(data.instructorChrome).toBe(true);
      },
    );

    describe("tab strip snapshot", () => {
      const cookie = `dali_tabstrip=1; dali_tabs=${encodeTabsSnapshot({
        tabs: [{ id: "t1", url: "/admin/site-users", origin: "/admin/site-users", label: "Site users", pinned: false, ephemeral: false, lastActivatedAt: 0, scrollY: 0, backStack: [], forwardStack: [] }],
        activeId: "t1",
        closed: [],
      })}`;
      const load = () =>
        loader({ request: new Request("https://os.test/education/offerings", { headers: { Cookie: cookie } }) } as never) as Promise<{
          tabsSnapshot: { tabs: { url: string }[] } | null;
        }>;

      it("draws the saved tabs", async () => {
        expect((await load()).tabsSnapshot?.tabs.map((t) => t.url)).toEqual(["/admin/site-users"]);
      });

      it("skips the admin's saved tabs while impersonating", async () => {
        vi.mocked(isImpersonating).mockReturnValue(true);
        expect((await load()).tabsSnapshot).toBeNull();
      });
    });

    it("skip the member-only signing and form gates", async () => {
      await run("/education/manage/o1").result;
      expect(layoutAppGate).not.toHaveBeenCalled();
      expect(layoutFormGate).not.toHaveBeenCalled();
    });

    it("go back to /portal from any other page", async () => {
      expect(location(await run("/projects").result)).toBe("/portal");
    });

    it("are still sent to the partner portal if the account is a partner", async () => {
      vi.mocked(redirectPartnerToPortal).mockResolvedValue(to("/partner") as never);
      expect(location(await run("/education/manage/o1").result)).toBe("/partner");
    });
  });

  it.each(["/education/manage/o1", "/education/offerings"])(
    "keeps a non-member who isn't an instructor out of %s",
    async (path) => {
      vi.mocked(isNonMember).mockResolvedValue(true);
      vi.mocked(layoutRoles).mockResolvedValue({ isLabMember: false, isInstructor: false } as never);
      expect(location(await run(path).result)).toBe("/portal");
    },
  );

  describe("non-member education deep links", () => {
    const student = { ok: true, user: { sub: "ada", email: "ada@example.edu", type: "dartmouth" } };

    beforeEach(() => {
      vi.mocked(requireAuth).mockResolvedValue(student as never);
      vi.mocked(isNonMember).mockResolvedValue(true);
      vi.mocked(layoutRoles).mockResolvedValue({ isLabMember: false, isInstructor: false } as never);
    });

    it.each([
      ["/education", "/portal/education"],
      ["/education/o1", "/portal/education/o1"],
      ["/education/o1/apply", "/portal/education/o1/apply"],
      ["/education/o1/apply?ref=flyer", "/portal/education/o1/apply?ref=flyer"],
      ["/education/o1/hub", "/portal/education/o1/hub"],
      ["/education/o1/page/p1", "/portal/education/o1/page/p1"],
      ["/education/o1/assignments/a1", "/portal/education/o1/assignments/a1"],
    ])("sends %s to %s", async (path, twin) => {
      expect(location(await run(path).result)).toBe(twin);
    });

    it("sends an external instructor's student links to the portal too", async () => {
      vi.mocked(layoutRoles).mockResolvedValue({ isLabMember: false, isInstructor: true } as never);
      expect(location(await run("/education/o1").result)).toBe("/portal/education/o1");
    });

    it("keeps pages with no twin going to /portal", async () => {
      expect(location(await run("/education/compliance").result)).toBe("/portal");
      expect(location(await run("/projects").result)).toBe("/portal");
    });

    it("sends a partner to the partner portal, not the twin", async () => {
      vi.mocked(redirectPartnerToPortal).mockResolvedValue(to("/partner") as never);
      expect(location(await run("/education/o1").result)).toBe("/partner");
    });

    it("doesn't send a member-type account with no member row to the twin, which would loop", async () => {
      vi.mocked(requireAuth).mockResolvedValue({ ...student, user: { ...student.user, type: "member" } } as never);
      expect(location(await run("/education/o1").result)).toBe("/portal");
    });
  });

  it("propagates a failed shell read instead of redirecting", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);
    vi.mocked(loadShellUser).mockRejectedValue(new Error("db down"));
    await expect(run().result).rejects.toThrow("db down");
  });
});
