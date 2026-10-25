// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StudioChecklist } from "../StudioChecklist";
import type { Criterion, CriterionResult } from "~/journeys/lib/studio-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const crit = (id: string, mode: Criterion["mode"], label = `Do ${id}`): Criterion => ({ id, label, mode });
const result = (criterion: Criterion, state: CriterionResult["state"], detail?: string): CriterionResult => ({ criterion, state, detail });

function render(results: CriterionResult[], canTick = true, onToggleSelf = vi.fn()) {
  act(() => root.render(createElement(StudioChecklist, { results, canTick, onToggleSelf })));
  return onToggleSelf;
}

describe("StudioChecklist", () => {
  it("groups criteria by how they're checked, in auto, self, mentor order", () => {
    render([result(crit("m", "mentor"), "pending"), result(crit("a", "auto"), "fail"), result(crit("s", "self"), "fail")]);
    expect([...container.querySelectorAll("h3")].map((h) => h.textContent)).toEqual([
      "Checked automatically",
      "Check your own work",
      "Mentor review",
    ]);
  });

  it("leaves out groups with no criteria", () => {
    render([result(crit("a", "auto"), "pass")]);
    expect(container.querySelectorAll("h3")).toHaveLength(1);
  });

  it("shows automatic progress detail and pass state", () => {
    render([result(crit("a", "auto"), "pass", "3 of 3"), result(crit("b", "auto"), "fail", "1 of 3")]);
    expect(container.textContent).toContain("3 of 3");
    expect(container.querySelector('[aria-label="Done"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Not yet"]')).not.toBeNull();
  });

  it("marks mentor items as waiting until reviewed", () => {
    render([result(crit("m", "mentor"), "pending")]);
    expect(container.querySelector('[aria-label="Waiting for review"]')).not.toBeNull();
  });

  it("lets the learner tick self-checks", () => {
    const onToggle = render([result(crit("s", "self"), "fail")]);
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    act(() => box.click());
    expect(onToggle).toHaveBeenCalledWith("s");
  });

  it("disables self-checks once the work is locked", () => {
    render([result(crit("s", "self"), "pass")], false);
    const box = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
  });

  it("names untitled criteria", () => {
    render([result(crit("a", "auto", ""), "fail")]);
    expect(container.textContent).toContain("Untitled criterion");
  });
});
