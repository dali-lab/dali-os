// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { FeedbackButton } from "~/components/feedback/FeedbackButton";
import { ToastProvider } from "~/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderButton() {
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () =>
        createElement(
          ToastProvider,
          null,
          createElement(FeedbackButton, { pagePath: "/", onOpenFeed: () => {} }),
        ),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

describe("FeedbackButton placement", () => {
  it("sits left of the side panel on md+ screens by its published width, and flush right without one", async () => {
    await renderButton();
    const host = container.querySelector(".fixed")!;
    expect(host.className).toContain("right-4");
    expect(host.className).toContain("md:right-[calc(1rem+var(--side-panel-w,0px))]");
  });
});

describe("FeedbackButton menu", () => {
  it("shows a tooltip on focus and opens a menu with View requests", async () => {
    await renderButton();
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Feedback"]')!;
    await act(async () => {
      button.focus();
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Send feedback or view requests",
    );
    await act(async () => {
      button.click();
    });
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent);
    expect(items).toEqual(["View requests", "Send feedback"]);
  });
});
