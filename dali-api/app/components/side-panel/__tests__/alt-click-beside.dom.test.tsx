// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { useAltClickOpensBeside, useVisibleSidePanel } from "~/components/side-panel/use-side-panel";
import { formatSidePanel, setKeptSidePanel } from "~/lib/side-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Probe() {
  useAltClickOpensBeside();
  const panel = useVisibleSidePanel();
  return (
    <>
      <output data-testid="panel">{panel ? formatSidePanel(panel) : ""}</output>
      <a href="/documents/abc">doc</a>
      <a href="/documents/abc"><span id="inner">inner</span></a>
      <a href="/projects/abc">project</a>
      <a href="https://example.com/documents/abc">external</a>
    </>
  );
}

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter>
        <Probe />
      </MemoryRouter>,
    ),
  );
}

function click(el: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}

const shown = () => container.querySelector("[data-testid=panel]")!.textContent;
const docLink = () => container.querySelector<HTMLAnchorElement>("a[href='/documents/abc']")!;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  act(() => setKeptSidePanel(null));
  window.history.replaceState(null, "", "/");
});

describe("option-click on a document link", () => {
  it("opens the document beside and cancels the navigation", () => {
    mount();
    const event = click(docLink(), { altKey: true });
    expect(shown()).toBe("doc:abc");
    expect(event.defaultPrevented).toBe(true);
  });

  it("works from an element inside the link", () => {
    mount();
    click(container.querySelector("#inner")!, { altKey: true });
    expect(shown()).toBe("doc:abc");
  });

  it.each([
    ["plain", {}],
    ["meta", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["alt with meta", { altKey: true, metaKey: true }],
  ])("leaves a %s click alone", (_name, init) => {
    mount();
    const event = click(docLink(), init);
    expect(shown()).toBe("");
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves links that are not documents alone", () => {
    mount();
    const project = click(container.querySelector("a[href='/projects/abc']")!, { altKey: true });
    const external = click(container.querySelector("a[href^='https://example.com']")!, { altKey: true });
    expect(shown()).toBe("");
    expect(project.defaultPrevented).toBe(false);
    expect(external.defaultPrevented).toBe(false);
  });
});
