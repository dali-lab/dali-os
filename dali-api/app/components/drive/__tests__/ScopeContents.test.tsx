import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DndContext } from "@dnd-kit/core";
import { ScopeContents, SearchResults, searchAll } from "~/components/drive/DriveBrowser";
import type { DriveTreeScope } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";

const at = new Date("2026-01-01T00:00:00Z");
const folder = (id: string, itemCount?: number): DriveItem => ({
  type: "folder", id, title: `Folder ${id}`, parentFolderId: null, iconEmoji: null, updatedAt: at, href: `/documents/${id}`, itemCount,
});
const doc = (id: string): DriveItem => ({
  type: "doc", id, title: `Doc ${id}`, parentFolderId: null, iconEmoji: null, updatedAt: at, href: `/documents/${id}`,
});

const scope: DriveTreeScope = { id: "lab", label: "Lab-wide", iconEmoji: null, items: [] };
const actions = { onRename: vi.fn(), onRequestMove: vi.fn(), onDelete: vi.fn() };
const handlers = { onClick: vi.fn(), onToggle: vi.fn(), onContext: vi.fn(), onOpen: vi.fn() };

function render(listing: DriveItem[], opts: { atScopeTop: boolean; viewMode?: "list" | "grid" }) {
  return renderToStaticMarkup(
    <DndContext>
      <ScopeContents
        scope={scope}
        atScopeTop={opts.atScopeTop}
        listing={listing}
        viewMode={opts.viewMode ?? "list"}
        sort={{ key: "name", dir: "asc" }}
        onToggleSort={vi.fn()}
        selected={new Set()}
        focusId={null}
        handlers={handlers}
        actions={actions}
        dragging={false}
      />
    </DndContext>,
  );
}

describe("ScopeContents folder band", () => {
  const listing = [folder("f1", 12), folder("f2", 0), doc("d1")];

  it("lays folders out as cards above the files at a space's top level", () => {
    const out = render(listing, { atScopeTop: true });
    expect(out).toContain('data-testid="drive-folder-band"');
    expect(out).toContain('data-testid="drive-item-folder-f1"');
    expect(out).toContain("12 items");
    expect(out).toContain(">Empty<");
    expect(out.indexOf("drive-folder-band")).toBeLessThan(out.indexOf("drive-item-doc-d1"));
    expect(out).toContain(">Files<");
  });

  it("renders each folder once, as a card and not also as a row", () => {
    const out = render(listing, { atScopeTop: true });
    expect(out.match(/data-testid="drive-item-folder-f1"/g)).toHaveLength(1);
  });

  it("keeps the same band in grid view", () => {
    const out = render(listing, { atScopeTop: true, viewMode: "grid" });
    expect(out).toContain('data-testid="drive-folder-band"');
    expect(out).toContain('data-testid="drive-item-doc-d1"');
  });

  it("keeps folders as ordinary rows inside a folder", () => {
    const out = render(listing, { atScopeTop: false });
    expect(out).not.toContain("drive-folder-band");
    expect(out).not.toContain(">Files<");
    expect(out).toContain('data-testid="drive-item-folder-f1"');
    expect(out).toContain('data-testid="drive-sort-name"');
  });

  it("drops the Files heading and header when there are only folders", () => {
    const out = render([folder("f1", 1)], { atScopeTop: true });
    expect(out).toContain("drive-folder-band");
    expect(out).not.toContain(">Files<");
    expect(out).not.toContain("drive-sort-name");
  });

  it("needs no band when there are no folders", () => {
    const out = render([doc("d1")], { atScopeTop: true });
    expect(out).not.toContain("drive-folder-band");
    expect(out).not.toContain(">Files<");
    expect(out).toContain("drive-sort-name");
  });

  it.each(["list", "grid"] as const)("gives every row, tile and band card a labelled checkbox and an id to find it by in %s view", (viewMode) => {
    const out = render(listing, { atScopeTop: true, viewMode });
    for (const [id, title] of [["f1", "Folder f1"], ["f2", "Folder f2"], ["d1", "Doc d1"]]) {
      expect(out).toContain(`aria-label="Select ${title}"`);
      expect(out).toContain(`data-item-id="${id}"`);
    }
  });

  it("shows the folder count under the name in grid tiles inside a folder", () => {
    expect(render([folder("f1", 3)], { atScopeTop: false, viewMode: "grid" })).toContain("3 items");
  });
});

describe("SearchResults location column", () => {
  const scopes: DriveTreeScope[] = [
    { id: "lab", label: "Lab-wide", iconEmoji: null, items: [folder("f1"), { ...doc("d1"), parentFolderId: "f1" }] },
  ];

  it("shows where each hit lives, with a Location header", () => {
    const hits = searchAll(scopes, "doc", "all");
    const out = renderToStaticMarkup(
      <SearchResults
        hits={hits}
        selected={new Set()}
        focusId={null}
        handlers={handlers}
        onOpenLocation={vi.fn()}
        getScopeActions={() => actions}
      />,
    );
    expect(out).toContain(">Location<");
    expect(out).toContain('data-testid="drive-search-hit-d1"');
    expect(out).toContain('title="Lab-wide › Folder f1"');
  });

  it("labels a checkbox on each hit", () => {
    const hits = searchAll(scopes, "doc", "all");
    const out = renderToStaticMarkup(
      <SearchResults
        hits={hits}
        selected={new Set()}
        focusId={null}
        handlers={handlers}
        onOpenLocation={vi.fn()}
        getScopeActions={() => actions}
      />,
    );
    expect(out).toContain('aria-label="Select Doc d1"');
    expect(out).toContain('data-item-id="d1"');
  });
});
