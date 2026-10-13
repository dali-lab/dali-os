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
  item: { type: "doc", isNotebook: true, id, title: `Notebook ${id}`, parentFolderId: null, iconEmoji: null, updatedAt: NOW, href: `/documents/${id}` },
  nextAt,
  meetingTitle,
});

const empty: DriveHomeData = { recent: [], starred: [], upcoming: [] };
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

  it("omits empty sections and keeps upcoming, recent, starred order", () => {
    expect(homeSections({ ...empty, starred: [doc("a")], upcoming: [notebook("n", hours(1), "x")] })).toEqual([
      "upcoming",
      "starred",
    ]);
    expect(homeSections({ upcoming: [notebook("n", hours(1), "x")], recent: [doc("a")], starred: [doc("b")] })).toEqual([
      "upcoming",
      "recent",
      "starred",
    ]);
  });
});

describe("DriveHome", () => {
  it("renders nothing when all sections are empty", () => {
    expect(render(empty)).toBe("");
  });

  it("renders only the sections that have cards", () => {
    const html = render({ ...empty, recent: [doc("a")] });
    expect(html).toContain('data-testid="drive-home-recent"');
    expect(html).not.toContain('data-testid="drive-home-upcoming"');
    expect(html).not.toContain('data-testid="drive-home-starred"');
    expect(html).toContain(">Recent<");
  });

  it("shows the upcoming notebook with its next time and meeting title", () => {
    const html = render({ ...empty, upcoming: [notebook("n1", hours(3), "Weekly sync")] });
    expect(html).toContain(">Upcoming meetings<");
    expect(html).toContain("Notebook n1");
    expect(html).toContain("Next in 3 hours · Weekly sync");
    expect(html).toContain('href="/documents/n1"');
    expect(html).not.toContain('data-testid="drive-location"');
  });

  it("shows recent cards with opened time and a location link", () => {
    const html = render({ ...empty, recent: [doc("a")] });
    expect(html).toContain("Doc a");
    expect(html).toContain("Opened 2 hours ago");
    expect(html).toContain('data-testid="drive-location"');
    expect(html).toContain("Lab");
    expect(html).toContain("Plans");
  });

  it("leaves the location out when the item's space is not loaded", () => {
    const html = render({ ...empty, recent: [doc("zzz")] });
    expect(html).not.toContain('data-testid="drive-location"');
  });

  it("marks starred cards with a star", () => {
    const starred = render({ ...empty, starred: [doc("a")] });
    const recent = render({ ...empty, recent: [doc("a")] });
    expect(starred).toContain("lucide-star");
    expect(recent).not.toContain("lucide-star");
  });

  it("omits the opened line when there is no visit time", () => {
    const html = render({ ...empty, starred: [doc("a", { visitedAt: null })] });
    expect(html).not.toContain("Opened");
  });

  it("uses the shared card tokens and focusable links", () => {
    const html = render({ ...empty, recent: [doc("a")] });
    expect(html).toContain("rounded-os-card");
    expect(html).toContain("bg-os-card");
    expect(html).toContain("hover:bg-os-card-hover");
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
