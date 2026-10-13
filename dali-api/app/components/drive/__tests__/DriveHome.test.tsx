import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DriveHome, homeItemHref } from "~/components/drive/DriveHome";
import { homeSections } from "~/components/drive/home-sections";
import type { DriveHomeData, HomePageItem, HomeUpcoming } from "~/lib/drive-home.server";
import type { LocatableScope } from "~/components/drive/location";

const NOW = new Date("2026-10-13T12:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

const doc = (id: string, extra: Record<string, unknown> = {}): HomePageItem =>
  ({
    type: "doc",
    id,
    title: `Doc ${id}`,
    parentFolderId: "f1",
    iconEmoji: null,
    updatedAt: NOW,
    href: `/documents/${id}`,
    visitedAt: hours(-2),
    ...extra,
  }) as HomePageItem;

const notebook = (id: string, nextAt: Date, meetingTitle: string): HomeUpcoming => ({
  meetingId: `m-${id}`,
  item: { type: "doc", isNotebook: true, id, title: `Notebook ${id}`, parentFolderId: null, iconEmoji: null, updatedAt: NOW, href: `/documents/${id}` },
  nextAt,
  meetingTitle,
});

const empty: DriveHomeData = { recent: [], upcoming: [] };
const scopes: LocatableScope[] = [
  { id: "lab", label: "Lab", items: [{ id: "f1", title: "Plans", parentFolderId: null }, { id: "a", title: "Doc a", parentFolderId: "f1" }] },
];

const render = (data: DriveHomeData) =>
  renderToStaticMarkup(createElement(DriveHome, { data, scopes, onOpen: vi.fn(), onNavigate: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("homeSections", () => {
  it("is empty when there is nothing to show", () => {
    expect(homeSections(empty)).toEqual([]);
  });

  it("omits empty sections and keeps upcoming, recent order", () => {
    expect(homeSections({ ...empty, upcoming: [notebook("n", hours(1), "x")] })).toEqual(["upcoming"]);
    expect(homeSections({ upcoming: [notebook("n", hours(1), "x")], recent: [doc("a")] })).toEqual(["upcoming", "recent"]);
  });
});

describe("DriveHome", () => {
  it("renders nothing when all sections are empty", () => {
    expect(render(empty)).toBe("");
  });

  it("renders only the sections that have rows", () => {
    const html = render({ ...empty, recent: [doc("a")] });
    expect(html).toContain('data-testid="drive-home-recent"');
    expect(html).not.toContain('data-testid="drive-home-upcoming"');
    expect(html).toContain(">Recent<");
  });

  it("has no Starred heading or star glyph", () => {
    const html = render({ upcoming: [notebook("n1", hours(3), "Weekly sync")], recent: [doc("a")] });
    expect(html).not.toContain("Starred");
    expect(html).not.toContain("drive-home-starred");
    expect(html).not.toContain("lucide-star");
  });

  it("titles an upcoming row by the meeting and puts the time and notebook in the reason", () => {
    const html = render({ ...empty, upcoming: [notebook("n1", hours(3), "Weekly sync")] });
    expect(html).toContain(">Upcoming meetings<");
    expect(html).toMatch(/<a [^>]*href="\/documents\/n1"[^>]*>Weekly sync<\/a>/);
    expect(html).toContain("in 3 hours · Notebook n1");
    expect(html).not.toContain("Next in");
    expect(html).not.toContain('data-testid="drive-location"');
  });

  it("shows recent rows with the opened time and a location link", () => {
    const html = render({ ...empty, recent: [doc("a")] });
    expect(html).toContain("Doc a");
    expect(html).toContain("Opened 2 hours ago");
    expect(html).toContain('data-testid="drive-location"');
    expect(html).toContain("Lab");
    expect(html).toContain("Plans");
  });

  it("keeps the location on one line and hides it below md", () => {
    const html = render({ ...empty, recent: [doc("a")] });
    expect(html).toMatch(/<button [^>]*class="[^"]*\btruncate\b/);
    expect(html).toMatch(/<div class="[^"]*\bhidden\b[^"]*\bmin-w-0\b[^"]*\bmd:block\b/);
  });

  it("truncates the title and lays rows out as a list with no horizontal scrollers", () => {
    const html = render({ upcoming: [notebook("n1", hours(3), "Weekly sync")], recent: [doc("a")] });
    expect(html).toMatch(/<a [^>]*class="[^"]*\bmin-w-0\b[^"]*\btruncate\b/);
    expect(html).toContain("hover:bg-os-container");
    expect(html).toContain("rounded-os-item");
    expect(html).not.toContain("overflow-x-auto");
    expect(html).not.toContain("w-56");
  });

  it("leaves the location out when the item's space is not loaded", () => {
    const html = render({ ...empty, recent: [doc("zzz")] });
    expect(html).not.toContain('data-testid="drive-location"');
  });

  it("omits the opened text when there is no visit time", () => {
    const html = render({ ...empty, recent: [doc("a", { visitedAt: null })] });
    expect(html).not.toContain("Opened");
  });

  it("makes the whole row a focusable link", () => {
    const html = render({ ...empty, recent: [doc("a")] });
    expect(html).toContain("focus-within:ring-2");
    expect(html).toContain("after:absolute after:inset-0");
    expect(html).toMatch(/<a [^>]*href="\/documents\/a"/);
  });

  it("names an untitled item", () => {
    expect(render({ ...empty, recent: [doc("a", { title: "" })] })).toContain("Untitled");
  });
});

describe("homeItemHref", () => {
  it("reveals folders in the Drive instead of opening them as documents", () => {
    expect(homeItemHref(doc("f9", { type: "folder" }))).toBe("/drive/reveal/f9");
  });

  it("opens whiteboards and docs at their own href", () => {
    expect(homeItemHref(doc("w", { href: "/whiteboard/w" }))).toBe("/whiteboard/w");
  });
});
