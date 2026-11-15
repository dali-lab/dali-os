// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { useColumnLayout } from "../task-board-shared";
import { renderDom } from "~/test-utils/render";

afterEach(() => window.localStorage.clear());

function Probe() {
  const { hideEmptyCols, toggleHideEmpty, collapsedCols } = useColumnLayout();
  return createElement(
    "button",
    { onClick: toggleHideEmpty },
    `${hideEmptyCols ? "hide" : "show"}:${collapsedCols.join(",")}`,
  );
}

describe("useColumnLayout saved prefs", () => {
  it("reads the old \"0\" hide-empty value and the collapsed column list", () => {
    window.localStorage.setItem("taskboard:hideEmptyCols", "0");
    window.localStorage.setItem("taskboard:collapsedCols", '["Backlog","Nonsense"]');
    const { container } = renderDom(createElement(Probe));
    expect(container.textContent).toBe("show:Backlog");
  });

  it("defaults to hiding empty columns and writes \"1\"/\"0\" back", () => {
    const { container } = renderDom(createElement(Probe));
    const button = container.querySelector("button")!;
    expect(button.textContent).toBe("hide:");
    act(() => button.click());
    expect(window.localStorage.getItem("taskboard:hideEmptyCols")).toBe("0");
    act(() => button.click());
    expect(window.localStorage.getItem("taskboard:hideEmptyCols")).toBe("1");
  });
});
