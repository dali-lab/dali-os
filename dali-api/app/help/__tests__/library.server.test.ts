import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", async (orig) => ({
  ...(await orig<typeof import("~/lib/roles")>()),
  isLabMentor: vi.fn(),
}));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));

import { isLabMentor, type UserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { findHelpArticle, loadHelpArticles, shortcutsArticle, visibleHelpArticles } from "../library.server";
import { parseHelpArticle, type HelpArticleDoc } from "../article-format";

const NONE: UserRoles = {
  isLabMember: false,
  isCore: false,
  isAdmin: false,
  isDomainLead: false,
  isInstructor: false,
  isInterviewer: false,
  isAlumni: false,
  isStaff: false,
  canViewForms: false,
  canViewStaffing: false,
};
const MEMBER = { ...NONE, isLabMember: true };
const viewer = (roles: Partial<UserRoles> = {}) => ({ userId: "u1", roles: { ...MEMBER, ...roles } });

const doc = (slug: string, header = "") => parseHelpArticle(slug, `---\ntitle: ${slug}\nsummary: s\n${header}\n---\nBody`);
const slugs = (as: HelpArticleDoc[]) => as.map((a) => a.slug);

beforeEach(() => {
  vi.mocked(isLabMentor).mockReset().mockResolvedValue(false);
  vi.mocked(isFeatureEnabled).mockReset().mockResolvedValue(false);
});

describe("visibleHelpArticles", () => {
  const all = doc("all");
  const core = doc("core", "audience: [core]");
  const leads = doc("leads", "audience: [domain-lead, admin]");
  const mentors = doc("mentors", "audience: [mentor, core]");

  it("shows unrestricted articles to every lab member and hides the rest", async () => {
    expect(slugs(await visibleHelpArticles(viewer(), [all, core, leads]))).toEqual(["all"]);
  });

  it("shows an article when any one of its audiences matches", async () => {
    expect(slugs(await visibleHelpArticles(viewer({ isAdmin: true }), [core, leads]))).toEqual(["leads"]);
    expect(slugs(await visibleHelpArticles(viewer({ isDomainLead: true }), [leads]))).toEqual(["leads"]);
  });

  it("shows nothing to someone who isn't in the lab", async () => {
    expect(await visibleHelpArticles({ userId: "u1", roles: NONE }, [all])).toEqual([]);
  });

  it("asks whether someone mentors only when an article needs it, and once", async () => {
    await visibleHelpArticles(viewer(), [all, core]);
    expect(isLabMentor).not.toHaveBeenCalled();

    vi.mocked(isLabMentor).mockResolvedValue(true);
    const mentors2 = doc("mentors2", "audience: [mentor]");
    expect(slugs(await visibleHelpArticles(viewer(), [mentors, mentors2]))).toEqual(["mentors", "mentors2"]);
    expect(isLabMentor).toHaveBeenCalledTimes(1);
    expect(isLabMentor).toHaveBeenCalledWith("u1", undefined, undefined);
  });

  it("skips the mentor check when another audience already matches", async () => {
    expect(slugs(await visibleHelpArticles(viewer({ isCore: true }), [doc("m", "audience: [core, mentor]")]))).toEqual(["m"]);
    expect(isLabMentor).not.toHaveBeenCalled();
  });

  it("hides a flagged article unless the flag is on for this person", async () => {
    const flagged = doc("flagged", "flag: ask-dali");
    expect(await visibleHelpArticles(viewer(), [flagged])).toEqual([]);
    vi.mocked(isFeatureEnabled).mockClear().mockResolvedValue(true);
    expect(slugs(await visibleHelpArticles(viewer(), [flagged, doc("again", "flag: ask-dali")]))).toEqual(["flagged", "again"]);
    expect(isFeatureEnabled).toHaveBeenCalledTimes(1);
    expect(isFeatureEnabled).toHaveBeenCalledWith("ask-dali", "u1", MEMBER, undefined);
  });

  it("hides an article whose flag doesn't exist", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    expect(await visibleHelpArticles(viewer(), [doc("x", "flag: no-such-flag")])).toEqual([]);
  });
});

describe("loadHelpArticles", () => {
  it("names each article after its file, adds the shortcuts article, and sorts by title", () => {
    const articles = loadHelpArticles({
      "./articles/zebra.md": "---\ntitle: Zebra\nsummary: z\n---\nZ",
      "./articles/apples.md": "---\ntitle: Apples\nsummary: a\n---\nA",
    });
    expect(articles.map((a) => [a.slug, a.url])).toEqual([
      ["apples", "/help/articles/apples"],
      ["shortcuts", "/help/shortcuts"],
      ["zebra", "/help/articles/zebra"],
    ]);
  });

  it("writes the shortcuts article from the shortcut table", () => {
    const body = shortcutsArticle().body;
    expect(body).toContain("## General");
    expect(body).toMatch(/^- .+: .+$/m);
  });
});

describe("findHelpArticle", () => {
  it("returns a visible article by slug and null otherwise", async () => {
    expect((await findHelpArticle(viewer(), "shortcuts"))?.title).toBe("Keyboard shortcuts");
    expect(await findHelpArticle(viewer(), "no-such-article")).toBeNull();
    expect(await findHelpArticle({ userId: "u1", roles: NONE }, "shortcuts")).toBeNull();
  });
});
