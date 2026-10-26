// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetcher = vi.hoisted(() => ({ data: undefined as unknown, load: vi.fn() }));

vi.mock("react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useFetcher: () => fetcher,
}));
vi.mock("~/components/DocumentEditor", () => ({
  DocumentEditor: ({ collabToken }: { collabToken: string }) => (
    <div data-testid="editor">{collabToken}</div>
  ),
}));
vi.mock("~/components/side-panel/PanelFrame", () => ({
  PanelFrame: ({
    title,
    icon,
    children,
  }: {
    title: string;
    icon?: string | null;
    children: React.ReactNode;
  }) => (
    <div>
      <h1 data-testid="title">{title}</h1>
      <span data-testid="icon">{icon ?? ""}</span>
      {children}
    </div>
  ),
}));

import DocumentPanel, { clearDocumentPanelHeaders } from "~/components/side-panel/DocumentPanel";

let container: HTMLDivElement;
let root: Root;

function docResult(title: string, iconEmoji: string | null = null) {
  return { kind: "doc", data: { pageId: "x", title, iconEmoji, collabToken: "tok" } };
}

function render(id: string) {
  act(() => {
    root.render(<DocumentPanel panel={{ type: "doc", id }} onClose={() => {}} />);
  });
}

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`);

beforeEach(() => {
  fetcher.data = undefined;
  fetcher.load.mockClear();
  clearDocumentPanelHeaders();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DocumentPanel header cache", () => {
  it("shows a spinner and no title on a first open", () => {
    render("a");
    expect(q("title")?.textContent).toBe("");
    expect(q("panel-body-placeholder")).toBeNull();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows the cached title and icon before the fetch resolves on a second open", () => {
    render("a");
    fetcher.data = docResult("Roadmap", "🗺️");
    render("a");
    act(() => root.unmount());
    root = createRoot(container);

    fetcher.data = undefined;
    render("a");
    expect(q("title")?.textContent).toBe("Roadmap");
    expect(q("icon")?.textContent).toBe("🗺️");
    expect(q("panel-body-placeholder")).not.toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(fetcher.load).toHaveBeenLastCalledWith("/api/documents/a/panel");
  });

  it("never renders the editor from the cache", () => {
    render("a");
    fetcher.data = docResult("Roadmap");
    render("a");
    act(() => root.unmount());
    root = createRoot(container);

    fetcher.data = undefined;
    render("a");
    expect(q("editor")).toBeNull();

    fetcher.data = docResult("Roadmap v2");
    render("a");
    expect(q("editor")?.textContent).toBe("tok");
    expect(q("title")?.textContent).toBe("Roadmap v2");
  });

  it("does not show one document's title on another", () => {
    render("a");
    fetcher.data = docResult("Roadmap");
    render("a");
    act(() => root.unmount());
    root = createRoot(container);

    fetcher.data = undefined;
    render("b");
    expect(q("title")?.textContent).toBe("");
    expect(q("panel-body-placeholder")).toBeNull();
  });
});
