// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { AlumniGameInvite } from "./AlumniGameInvite";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Where() {
  return createElement("span", { "data-testid": "where" }, useLocation().pathname);
}

function mount(variant?: "game" | "onboarding") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(AlumniGameInvite, { firstName: "Ada", variant }),
        createElement(Where),
      ),
    ),
  );
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  sessionStorage.clear();
});

const press = (label: string) =>
  act(() => {
    ([...document.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement).click();
  });
const where = () => document.querySelector('[data-testid="where"]')?.textContent;

describe("AlumniGameInvite", () => {
  it("sends the game variant to the avatar creator, as before", () => {
    mount();
    expect(document.body.textContent).toContain("Build your pixel avatar");
    press("Create my avatar");
    expect(where()).toBe("/alumni/welcome");
  });

  it("sends the onboarding variant to the new flow", () => {
    mount("onboarding");
    expect(document.body.textContent).toContain("Welcome back, Ada!");
    expect(document.body.textContent).not.toContain("pixel avatar");
    press("Get started");
    expect(where()).toBe("/alumni/onboarding");
  });

  it("stays quiet for the rest of the session after Maybe later", () => {
    mount("onboarding");
    press("Maybe later");
    expect(document.body.textContent).not.toContain("Get started");
    act(() => root.unmount());
    container.remove();
    mount("onboarding");
    expect(document.body.textContent).not.toContain("Get started");
  });
});
