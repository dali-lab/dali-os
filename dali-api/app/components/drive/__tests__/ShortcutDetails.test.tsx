import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AlsoInList, OriginalValue } from "~/components/drive/ShortcutDetails";
import type { ShortcutPlace } from "~/components/drive/file-in";
import type { ItemLocation } from "~/components/drive/location";
import type { DriveItem } from "~/lib/drive.server";

type ShortcutItem = Extract<DriveItem, { type: "shortcut" }>;
const shortcut = (extra: Partial<ShortcutItem> = {}): ShortcutItem => ({
  type: "shortcut",
  id: "s",
  title: "Kickoff notes",
  parentFolderId: "f",
  iconEmoji: null,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  href: "/documents/t",
  targetId: "t",
  targetType: "doc",
  canOpen: true,
  originalInTrash: false,
  ...extra,
});
const location: ItemLocation = {
  scopeId: "projects",
  scopeLabel: "Projects",
  folderId: "m",
  folders: [{ id: "m", title: "Meetings" }],
  path: "Projects › Meetings",
};

describe("OriginalValue", () => {
  it("links to where the original lives", () => {
    const out = renderToStaticMarkup(<OriginalValue item={shortcut()} location={location} onNavigate={vi.fn()} />);
    expect(out).toContain("Projects");
    expect(out).toContain("Meetings");
    expect(out).toContain('data-testid="drive-location"');
  });

  it("falls back to the title when the original isn't among the loaded spaces", () => {
    const out = renderToStaticMarkup(<OriginalValue item={shortcut()} location={null} onNavigate={vi.fn()} />);
    expect(out).toContain("Kickoff notes");
    expect(out).not.toContain("drive-location");
  });

  it("says the original is in the trash, with no path", () => {
    const out = renderToStaticMarkup(
      <OriginalValue item={shortcut({ canOpen: false, originalInTrash: true })} location={location} onNavigate={vi.fn()} />,
    );
    expect(out).toContain("Original in trash");
    expect(out).not.toContain("drive-location");
  });

  it("says there is no access, with a lock and no path", () => {
    const out = renderToStaticMarkup(
      <OriginalValue item={shortcut({ canOpen: false })} location={location} onNavigate={vi.fn()} />,
    );
    expect(out).toContain("No access");
    expect(out).toContain("lucide-lock");
    expect(out).not.toContain("drive-location");
  });
});

describe("AlsoInList", () => {
  const places: ShortcutPlace[] = [
    {
      shortcutId: "s1",
      workspaceType: "Lab",
      workspaceId: null,
      folderId: "c",
      path: [
        { id: "core", title: "Core" },
        { id: "c", title: "Check-ins" },
      ],
    },
    { shortcutId: "s2", workspaceType: "Project", workspaceId: "p", folderId: null, path: [] },
  ];
  const render = (navigable: boolean, busy = false) =>
    renderToStaticMarkup(
      <AlsoInList
        places={places}
        busy={busy}
        navigable={() => navigable}
        onOpen={vi.fn()}
        onMakePrimary={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

  it("lists each shortcut's folder path with a Make primary and a remove control", () => {
    const out = render(true);
    expect(out.match(/data-testid="also-in-row"/g)).toHaveLength(2);
    expect(out).toContain("Core / Check-ins");
    expect(out).toContain("Project");
    expect(out).toContain('aria-label="Make Core / Check-ins the primary location"');
    expect(out).toContain('aria-label="Remove the shortcut in Core / Check-ins"');
  });

  it("makes a folder a button only when it can be opened from here", () => {
    expect(render(true)).toContain("hover:underline");
    expect(render(false)).not.toContain("hover:underline");
  });

  it("disables the controls while a change is in flight", () => {
    const out = render(true, true);
    expect(out.match(/disabled=""/g)).toHaveLength(4);
  });
});
