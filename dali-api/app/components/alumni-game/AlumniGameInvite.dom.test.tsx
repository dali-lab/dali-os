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

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(AlumniGameInvite, { firstName: "Ada" }),
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

const pressText = (text: string) =>
  act(() => {
    ([...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement).click();
  });

describe("AlumniGameInvite", () => {
  it("greets the alum by name and explains both paths", () => {
    mount();
    expect(document.body.textContent).toContain("Welcome back, Ada");
    expect(document.body.textContent).toContain("pixel version of the lab");
  });

  it("offers both paths", () => {
    mount();
    pressText("Fill it in");
    expect(where()).toBe("/alumni/onboarding");
    act(() => root.unmount());
    container.remove();
    mount();
    pressText("Walk the pixel lab");
    expect(where()).toBe("/alumni/welcome");
  });

  it("stays quiet for the rest of the session after Later", () => {
    mount();
    press("Later");
    expect(document.body.textContent).not.toContain("Fill it in");
    act(() => root.unmount());
    container.remove();
    mount();
    expect(document.body.textContent).not.toContain("Fill it in");
  });
});
