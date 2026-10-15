// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { ErrorScreen } = await import("~/components/ErrorScreen");

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(props: Parameters<typeof ErrorScreen>[0]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(ErrorScreen, props));
  });
  return host;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe("ErrorScreen", () => {
  it("shows the heading, description and the caller's actions, left-aligned and full width", async () => {
    const el = await mount({
      heading: "Page not found",
      description: "That page moved.",
      children: createElement("a", { href: "/" }, "Go to home"),
    });
    expect(el.querySelector("h1")?.textContent).toBe("Page not found");
    expect(el.textContent).toContain("That page moved.");
    expect(el.querySelector("a[href='/']")?.textContent).toBe("Go to home");
    const outer = el.firstElementChild as HTMLElement;
    expect(outer.className).not.toMatch(/mx-auto|max-w-|text-center/);
  });

  it("renders the runner game once mounted, and survives a canvas without 2d context", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const el = await mount({ heading: "Something went wrong", description: "Try again." });
    expect(el.querySelector("canvas")).not.toBeNull();
    expect(el.textContent).toContain("Press space or tap to run while you wait.");
  });

  it("leaves the game out of the server render so hydration matches", () => {
    const html = renderToString(createElement(ErrorScreen, { heading: "Error 500", description: "Oops." }));
    expect(html).not.toContain("<canvas");
    expect(html).toContain("Error 500");
  });

  it("shows a stack trace only when given one", async () => {
    const el = await mount({ heading: "Boom", description: "Dev only.", stack: "Error: boom\n at x" });
    expect(el.querySelector("pre code")?.textContent).toContain("Error: boom");
  });
});
