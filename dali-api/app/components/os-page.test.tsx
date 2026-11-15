// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { Download, Plus, Search } from "lucide-react";
import { renderDom, click } from "~/test-utils/render";
import {
  PageRowControls,
  PageRowControlsScope,
  PageTabRow,
  pageRowDensity,
  type PageTabControl,
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

const controls = (onNew = vi.fn()): PageTabControl[] => [
  { key: "search", label: "Search", icon: Search, onClick: () => {} },
  { key: "export", label: "Export", icon: Download, onClick: () => {} },
  { key: "new", label: "New", icon: Plus, primary: true, onClick: onNew },
];

const buttonLabels = (c: HTMLElement) =>
  [...c.querySelectorAll("button")].map((b) => b.textContent?.trim() || b.getAttribute("aria-label"));

describe("pageRowDensity", () => {
  it("steps from labels to icons to a menu to its own row", () => {
    expect(pageRowDensity(1000)).toBe("full");
    expect(pageRowDensity(921)).toBe("full");
    expect(pageRowDensity(920)).toBe("icons");
    expect(pageRowDensity(786)).toBe("icons");
    expect(pageRowDensity(785)).toBe("menu");
    expect(pageRowDensity(588)).toBe("menu");
    expect(pageRowDensity(587)).toBe("stacked");
  });
});

describe("PageTabRow", () => {
  it("renders the island, the controls and the gear, with the gear outside the tablist", () => {
    const onSettings = vi.fn();
    const { container } = renderDom(
      <PageTabRow label="Sections" tabs={TABS} controls={controls()} onSettings={onSettings} />,
    );
    const list = container.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("Sections");
    expect(list.querySelectorAll('[role="tab"]')).toHaveLength(2);
    const gear = container.querySelector<HTMLElement>('button[aria-label="Settings"]')!;
    expect(list.contains(gear)).toBe(false);
    click(gear);
    expect(onSettings).toHaveBeenCalledOnce();
    expect(buttonLabels(container)).toEqual(expect.arrayContaining(["Search", "Export", "New"]));
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

  it("shows every control with its label when wide", () => {
    const { container } = renderDom(<PageTabRow label="Sections" tabs={TABS} controls={controls()} />);
    resize!(1000);
    expect(container.firstElementChild!.getAttribute("data-density")).toBe("full");
    const search = [...container.querySelectorAll("button")].find((b) => b.textContent === "Search");
    expect(search).toBeDefined();
  });

  it("drops secondary controls to icons but keeps the primary label", () => {
    const { container } = renderDom(<PageTabRow label="Sections" tabs={TABS} controls={controls()} />);
    resize!(850);
    expect(container.firstElementChild!.getAttribute("data-density")).toBe("icons");
    const search = container.querySelector<HTMLElement>('button[aria-label="Search"]')!;
    expect(search.textContent).toBe("");
    const primary = [...container.querySelectorAll("button")].find((b) => b.textContent === "New");
    expect(primary).toBeDefined();
  });

  it("folds secondary controls into a menu but keeps the primary label", () => {
    const onNew = vi.fn();
    const { container } = renderDom(<PageTabRow label="Sections" tabs={TABS} controls={controls(onNew)} />);
    resize!(700);
    expect(container.firstElementChild!.getAttribute("data-density")).toBe("menu");
    expect(container.querySelector('button[aria-label="Search"]')).toBeNull();
    expect(container.querySelector('button[aria-label="More actions"]')).not.toBeNull();
    const primary = [...container.querySelectorAll("button")].find((b) => b.textContent === "New")!;
    click(primary);
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("moves the controls to their own row when narrow, leaving the island and gear on the first", () => {
    const { container } = renderDom(
      <PageTabRow label="Sections" tabs={TABS} controls={controls()} onSettings={() => {}} />,
    );
    resize!(500);
    const row = container.firstElementChild!;
    expect(row.getAttribute("data-density")).toBe("stacked");
    const controlsWrap = [...row.children].find((el) => el.textContent?.includes("New"))!;
    expect(controlsWrap.className).toContain("order-last");
    expect(controlsWrap.className).toContain("w-full");
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Settings"]')).not.toBeNull();
  });

  it("swaps controls with the tab", () => {
    const { container, rerender } = renderDom(
      <PageTabRow label="Sections" tabs={TABS} controls={controls()} />,
    );
    expect(buttonLabels(container)).toContain("Export");
    rerender(<PageTabRow label="Sections" tabs={TABS} controls={[]} />);
    expect(buttonLabels(container)).not.toContain("Export");
  });
});

describe("PageRowControls", () => {
  it("renders into the row's controls slot, outside the page content", () => {
    const { container } = renderDom(
      <PageRowControlsScope>
        <PageTabRow label="Sections" tabs={TABS} />
        <main data-testid="content">
          <PageRowControls>
            <button type="button">Upload</button>
          </PageRowControls>
        </main>
      </PageRowControlsScope>,
    );
    const upload = [...container.querySelectorAll("button")].find((b) => b.textContent === "Upload")!;
    expect(upload).toBeDefined();
    expect(container.querySelector('[data-testid="content"]')!.contains(upload)).toBe(false);
    expect(container.querySelector('[data-density]')!.contains(upload)).toBe(true);
  });

  it("renders in place without a row", () => {
    const { container } = renderDom(
      <main data-testid="content">
        <PageRowControls>
          <button type="button">Upload</button>
        </PageRowControls>
      </main>,
    );
    expect(container.querySelector('[data-testid="content"] button')!.textContent).toBe("Upload");
  });
});

