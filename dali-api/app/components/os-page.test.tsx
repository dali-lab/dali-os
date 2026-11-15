// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { Download, List, Plus, Search, LayoutGrid } from "lucide-react";
import { renderDom, click } from "~/test-utils/render";
import {
  PageRowControls,
  PageRowControlsScope,
  PageTabRow,
  usePageRowScoped,
  type PageRowControl,
} from "./os-page";

let resize: ((width: number) => void) | null = null;

beforeEach(() => {
  resize = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: (entries: { contentRect: { width: number } }[]) => void) {
        resize = (width) => act(() => cb([{ contentRect: { width } }]));
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const TABS = [
  { label: "Progress", icon: Plus, active: true, onClick: () => {} },
  { label: "Drive", icon: Download, onClick: () => {} },
];

const WIDTHS = { island: 200, gear: 28, controls: { full: 400, icons: 250, menu: 120 } as Record<string, number> };
let spy: ReturnType<typeof vi.spyOn> | null = null;

function mockWidths(widths = WIDTHS) {
  spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const slot = this.dataset.slot;
    const density = this.closest("[data-density]")?.getAttribute("data-density") ?? "full";
    const width =
      slot === "island" ? widths.island : slot === "gear" ? widths.gear : slot === "controls" ? (widths.controls[density] ?? 0) : 0;
    return { width, height: 28, top: 0, left: 0, right: width, bottom: 28, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
}
afterEach(() => spy?.mockRestore());

const controls = (onNew = vi.fn()): PageRowControl[] => [
  { kind: "search", key: "search", label: "Search files", value: "", onChange: () => {} },
  { key: "export", label: "Export", icon: Download, onClick: () => {} },
  {
    kind: "toggle",
    key: "view",
    label: "View",
    value: "list",
    onChange: () => {},
    options: [
      { value: "list", label: "List view", icon: List },
      { value: "grid", label: "Grid view", icon: LayoutGrid },
    ],
  },
  { key: "new", label: "New", icon: Plus, primary: true, onClick: onNew },
];

const buttonLabels = (c: HTMLElement) =>
  [...c.querySelectorAll("button")].map((b) => b.textContent?.trim() || b.getAttribute("aria-label"));
const densityOf = (c: HTMLElement) => c.firstElementChild!.getAttribute("data-density");
const byText = (c: HTMLElement, text: string) =>
  [...c.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

function mountRow(extra: Partial<Parameters<typeof PageTabRow>[0]> = {}) {
  return renderDom(<PageTabRow label="Sections" tabs={TABS} controls={controls()} {...extra} />);
}

describe("PageTabRow", () => {
  it("renders the island, the controls and the gear, with the gear outside the tablist", () => {
    const onSettings = vi.fn();
    const { container } = mountRow({ onSettings });
    const list = container.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("Sections");
    expect(list.querySelectorAll('[role="tab"]')).toHaveLength(2);
    const gear = container.querySelector<HTMLElement>('button[aria-label="Settings"]')!;
    expect(list.contains(gear)).toBe(false);
    click(gear);
    expect(onSettings).toHaveBeenCalledOnce();
    expect(buttonLabels(container)).toEqual(expect.arrayContaining(["Export", "New"]));
  });

  it("omits the gear without onSettings", () => {
    const { container } = renderDom(<PageTabRow label="Sections" tabs={TABS} />);
    expect(container.querySelector('button[aria-label="Settings"]')).toBeNull();
  });

  it("marks the gear pressed when settings are open", () => {
    const { container } = renderDom(
      <PageTabRow label="Sections" tabs={TABS} onSettings={() => {}} settingsActive />,
    );
    expect(container.querySelector('button[aria-label="Settings"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows every control with its label when they fit", () => {
    mockWidths();
    const { container } = mountRow();
    resize!(700);
    expect(densityOf(container)).toBe("full");
    expect(byText(container, "Export")).toBeDefined();
    expect(container.querySelector('input[aria-label="Search files"]')).not.toBeNull();
    expect(container.querySelector('[role="group"][aria-label="View"]')).not.toBeNull();
  });

  it("drops secondary controls to icons when the labeled set no longer fits", () => {
    mockWidths();
    const { container } = mountRow();
    resize!(600);
    expect(densityOf(container)).toBe("icons");
    const exportBtn = container.querySelector<HTMLElement>('button[aria-label="Export"]')!;
    expect(exportBtn.textContent).toBe("");
    expect(container.querySelector('input[aria-label="Search files"]')).not.toBeNull();
    expect(byText(container, "New")).toBeDefined();
  });

  it("folds into a menu, search becomes an icon and the primary keeps its label", () => {
    mockWidths();
    const onNew = vi.fn();
    const { container } = renderDom(<PageTabRow label="Sections" tabs={TABS} controls={controls(onNew)} />);
    resize!(400);
    expect(densityOf(container)).toBe("menu");
    expect(container.querySelector('input[aria-label="Search files"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Search files"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Export"]')).toBeNull();
    expect(container.querySelector('[role="group"][aria-label="View"]')).toBeNull();
    expect(container.querySelector('button[aria-label="More actions"]')).not.toBeNull();
    click(byText(container, "New")!);
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("opens the folded menu with the secondary actions and the view choices", () => {
    mockWidths();
    const { container } = mountRow();
    resize!(400);
    click(container.querySelector('button[aria-label="More actions"]')!);
    const items = [...document.querySelectorAll('[role^="menuitem"]')].map((e) => e.textContent?.trim());
    expect(items).toEqual(expect.arrayContaining(["Export", "List view", "Grid view"]));
  });

  it("moves the controls to their own row when even the menu does not fit, leaving the island and gear on the first", () => {
    mockWidths();
    const { container } = mountRow({ onSettings: () => {} });
    resize!(300);
    const row = container.firstElementChild!;
    expect(row.getAttribute("data-density")).toBe("stacked");
    const controlsWrap = row.querySelector('[data-slot="controls"]')!;
    expect(controlsWrap.className).toContain("order-last");
    expect(controlsWrap.className).toContain("w-full");
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Settings"]')).not.toBeNull();
  });

  it("counts the gear against the room, so the same width folds sooner with one", () => {
    mockWidths();
    const without = mountRow();
    resize!(640);
    expect(densityOf(without.container)).toBe("full");
    without.unmount();
    const withGear = mountRow({ onSettings: () => {} });
    resize!(640);
    expect(densityOf(withGear.container)).toBe("icons");
  });

  it("steps down and back up as the row resizes, settling on the same step each time", () => {
    mockWidths();
    const { container } = mountRow({ onSettings: () => {} });
    const seen: (string | null)[] = [];
    for (const width of [900, 600, 400, 300, 400, 600, 900, 900]) {
      resize!(width);
      seen.push(densityOf(container));
    }
    expect(seen).toEqual(["full", "icons", "menu", "stacked", "menu", "icons", "full", "full"]);
  });

  it("measures again when the controls change", () => {
    mockWidths();
    const { container, rerender } = mountRow();
    resize!(600);
    expect(densityOf(container)).toBe("icons");
    rerender(<PageTabRow label="Sections" tabs={TABS} controls={[{ key: "x", label: "X", icon: Plus, onClick: () => {} }]} />);
    expect(densityOf(container)).toBe("icons");
    expect(buttonLabels(container)).toContain("X");
  });

  it("swaps controls with the tab", () => {
    const { container, rerender } = mountRow();
    expect(buttonLabels(container)).toContain("Export");
    rerender(<PageTabRow label="Sections" tabs={TABS} controls={[]} />);
    expect(buttonLabels(container)).not.toContain("Export");
  });

  it("always renders the primary after the other controls and before the gear", () => {
    const { container } = renderDom(
      <PageTabRow
        label="Sections"
        tabs={TABS}
        onSettings={() => {}}
        controls={[
          { key: "new", label: "New", icon: Plus, primary: true, onClick: () => {} },
          { key: "export", label: "Export", icon: Download, onClick: () => {} },
          { kind: "search", key: "s", label: "Search files", value: "", onChange: () => {} },
        ]}
      />,
    );
    const order = [...container.querySelectorAll("button, input")].map(
      (e) => e.textContent?.trim() || e.getAttribute("aria-label"),
    );
    expect(order.slice(-4)).toEqual(["Export", "Search files", "New", "Settings"]);
  });

  it("renders a menu control labeled when wide, as an icon when narrower, and inside the overflow menu when folded", () => {
    mockWidths();
    const onSelect = vi.fn();
    const menu: PageRowControl = {
      kind: "menu",
      key: "add",
      label: "Add",
      icon: Plus,
      items: [{ key: "doc", label: "Document", onSelect }],
    };
    const { container } = renderDom(<PageTabRow label="Sections" tabs={TABS} controls={[menu]} />);
    WIDTHS.controls = { full: 400, icons: 250, menu: 120 };
    resize!(900);
    expect(byText(container, "Add")).toBeDefined();
    resize!(600);
    expect(densityOf(container)).toBe("icons");
    expect(byText(container, "Add")).toBeUndefined();
    expect(container.querySelector('button[aria-label="Add"]')).not.toBeNull();
    resize!(400);
    expect(densityOf(container)).toBe("menu");
    expect(container.querySelector('button[aria-label="Add"]')).toBeNull();
    click(container.querySelector('button[aria-label="More actions"]')!);
    expect(document.body.textContent).toContain("Add");
  });

  it("keeps a primary menu labeled in every step and opens its items", () => {
    mockWidths();
    const onSelect = vi.fn();
    const menu: PageRowControl = {
      kind: "menu",
      key: "new",
      label: "New",
      icon: Plus,
      primary: true,
      items: [{ key: "doc", label: "Document", onSelect }],
    };
    const { container } = renderDom(<PageTabRow label="Sections" tabs={TABS} controls={[menu]} />);
    for (const width of [900, 600, 400]) {
      resize!(width);
      expect(byText(container, "New")).toBeDefined();
    }
    click(byText(container, "New")!);
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent === "Document")!;
    click(item);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe("PageRowControls", () => {
  it("renders into the row, outside the page content", () => {
    const { container } = renderDom(
      <PageRowControlsScope>
        <PageTabRow label="Sections" tabs={TABS} />
        <main data-testid="content">
          <PageRowControls controls={[{ key: "up", label: "Upload", icon: Download, onClick: () => {} }]} />
        </main>
      </PageRowControlsScope>,
    );
    const upload = byText(container, "Upload")!;
    expect(upload).toBeDefined();
    expect(container.querySelector('[data-testid="content"]')!.contains(upload)).toBe(false);
    expect(container.querySelector("[data-density]")!.contains(upload)).toBe(true);
  });

  it("puts a slotted primary after the prop's controls and slotted secondaries, labeled in the menu step", () => {
    mockWidths();
    const { container } = renderDom(
      <PageRowControlsScope>
        <PageTabRow
          label="Sections"
          tabs={TABS}
          controls={[{ key: "a", label: "Alpha", icon: Download, onClick: () => {} }]}
        />
        <PageRowControls
          controls={[
            { key: "up", label: "Upload", icon: Download, primary: true, onClick: () => {} },
            { kind: "search", key: "s", label: "Search files", value: "", onChange: () => {} },
          ]}
        />
      </PageRowControlsScope>,
    );
    const order = () =>
      [...container.querySelectorAll("button, input")].map((e) => e.textContent?.trim() || e.getAttribute("aria-label"));
    resize!(900);
    expect(order().slice(-3)).toEqual(["Alpha", "Search files", "Upload"]);
    resize!(400);
    expect(densityOf(container)).toBe("menu");
    expect(byText(container, "Upload")).toBeDefined();
    expect(container.querySelector('button[aria-label="Search files"]')).not.toBeNull();
  });

  it("follows the latest handlers without being re-registered", () => {
    const first = vi.fn();
    const second = vi.fn();
    const Page = ({ onClick }: { onClick: () => void }) => (
      <PageRowControlsScope>
        <PageTabRow label="Sections" tabs={TABS} />
        <PageRowControls controls={[{ key: "up", label: "Upload", icon: Download, onClick }]} />
      </PageRowControlsScope>
    );
    const { container, rerender } = renderDom(<Page onClick={first} />);
    rerender(<Page onClick={second} />);
    click(byText(container, "Upload")!);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("removes the controls when the owner unmounts", () => {
    const Page = ({ show }: { show: boolean }) => (
      <PageRowControlsScope>
        <PageTabRow label="Sections" tabs={TABS} />
        {show && <PageRowControls controls={[{ key: "up", label: "Upload", icon: Download, onClick: () => {} }]} />}
      </PageRowControlsScope>
    );
    const { container, rerender } = renderDom(<Page show />);
    expect(byText(container, "Upload")).toBeDefined();
    rerender(<Page show={false} />);
    expect(byText(container, "Upload")).toBeUndefined();
  });

  it("reports whether a row is listening", () => {
    const Probe = () => <span data-testid="probe">{String(usePageRowScoped())}</span>;
    expect(renderDom(<Probe />).container.textContent).toBe("false");
    expect(renderDom(<PageRowControlsScope><Probe /></PageRowControlsScope>).container.textContent).toBe("true");
  });
});
