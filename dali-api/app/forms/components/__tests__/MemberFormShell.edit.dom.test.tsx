// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";

vi.mock("~/components/doc", () => ({ DocEditor: () => null }));

import { MemberFormShell } from "~/forms/components/MemberFormFillView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(props: { editFormHref?: string | null; flush?: boolean }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(MemoryRouter, null, createElement(MemberFormShell, { ...props, children: createElement("p", null, "Body") })),
    ),
  );
}

const editLink = () => container.querySelector<HTMLAnchorElement>("a[aria-label='Edit form']");

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MemberFormShell edit button", () => {
  it.each([false, true])("links an editor to the form editor (flush %s)", (flush) => {
    mount({ editFormHref: "/forms/edit/f1", flush });
    expect(editLink()?.getAttribute("href")).toBe("/forms/edit/f1");
    expect(container.textContent).toContain("Body");
  });

  it.each([null, undefined])("shows no edit button without a link (%s)", (editFormHref) => {
    mount({ editFormHref });
    expect(editLink()).toBeNull();
  });
});
