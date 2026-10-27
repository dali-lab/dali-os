// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { FeatureFlagsProvider } from "~/components/FeatureFlags";
import { useAltClickOpensBeside } from "~/components/side-panel/use-side-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Probe() {
  useAltClickOpensBeside();
  const { search } = useLocation();
  return (
    <>
      <output data-testid="search">{search}</output>
      <a href="/documents/abc">doc</a>
      <a href="/documents/abc"><span id="inner">inner</span></a>
      <a href="/projects/abc">project</a>
      <a href="https://example.com/documents/abc">external</a>
    </>
  );
}

function mount(enabled: boolean) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter>
        <FeatureFlagsProvider flags={{ "desktop-tabs": enabled }}>
          <Probe />
        </FeatureFlagsProvider>
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

const search = () => container.querySelector("[data-testid=search]")!.textContent;
const docLink = () => container.querySelector<HTMLAnchorElement>("a[href='/documents/abc']")!;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("option-click on a document link", () => {
  it("opens the document beside and cancels the navigation", () => {
    mount(true);
    const event = click(docLink(), { altKey: true });
    expect(search()).toBe("?side=doc%3Aabc");
    expect(event.defaultPrevented).toBe(true);
  });

  it("works from an element inside the link", () => {
    mount(true);
    click(container.querySelector("#inner")!, { altKey: true });
    expect(search()).toBe("?side=doc%3Aabc");
  });

  it.each([
    ["plain", {}],
    ["meta", { metaKey: true }],
    ["ctrl", { ctrlKey: true }],
    ["alt with meta", { altKey: true, metaKey: true }],
  ])("leaves a %s click alone", (_name, init) => {
    mount(true);
    const event = click(docLink(), init);
    expect(search()).toBe("");
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves links that are not documents alone", () => {
    mount(true);
    const project = click(container.querySelector("a[href='/projects/abc']")!, { altKey: true });
    const external = click(container.querySelector("a[href^='https://example.com']")!, { altKey: true });
    expect(search()).toBe("");
    expect(project.defaultPrevented).toBe(false);
    expect(external.defaultPrevented).toBe(false);
  });

  it("is not installed with desktop-tabs off", () => {
    mount(false);
    const event = click(docLink(), { altKey: true });
    expect(search()).toBe("");
    expect(event.defaultPrevented).toBe(false);
  });
});
