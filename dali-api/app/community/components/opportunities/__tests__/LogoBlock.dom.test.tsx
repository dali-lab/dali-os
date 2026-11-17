// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LogoBlock } from "~/community/components/opportunities/LogoBlock";
import { paletteFor } from "~/community/lib/block-color";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(props: Parameters<typeof LogoBlock>[0]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(LogoBlock, props)));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("LogoBlock", () => {
  it("renders the logo in a labeled tile", () => {
    const el = render({ name: "Acme", logoUrl: "/logo.png", color: "#112233" });
    expect(el.querySelector("image")?.getAttribute("href")).toBe("/logo.png");
    expect(el.querySelector("svg")?.getAttribute("aria-label")).toBe("Acme logo");
    expect(el.querySelector("text")).toBeNull();
    expect(el.querySelector("rect[fill='#112233']")).not.toBeNull();
  });

  it("renders the first letter as a decorative block without a logo", () => {
    const el = render({ name: "acme" });
    expect(el.querySelector("text")?.textContent).toBe("A");
    expect(el.querySelector("image")).toBeNull();
    expect(el.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("falls back to the palette when the color is invalid", () => {
    const el = render({ name: "Acme", color: "nope" });
    expect(el.querySelector("rect")?.getAttribute("fill")).toBe(paletteFor("Acme"));
  });

  it("animates only when drop is set", () => {
    expect(render({ name: "Acme", drop: true }).querySelector("svg")?.getAttribute("class")).toBe("opp-block-drop");
    act(() => root?.unmount());
    host?.remove();
    expect(render({ name: "Acme" }).querySelector("svg")?.getAttribute("class")).toBeNull();
  });
});
