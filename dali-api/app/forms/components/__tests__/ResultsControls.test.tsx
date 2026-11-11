// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

import { ExportCsvLink, ResultsSwitch, resultsViewParams } from "~/forms/components/ResultsControls";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

const render = async (node: React.ReactElement) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
};
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("resultsViewParams", () => {
  const from = (q: string) => new URLSearchParams(q);

  it("Questions drops every results param", () => {
    expect(resultsViewParams(from("view=results&version=2&show=responses&q=a&a=k:answered"), "questions", 2).toString()).toBe("");
  });

  it("Summary drops show and page and keeps the rest", () => {
    const next = resultsViewParams(from("view=results&version=2&show=responses&page=3&q=ada"), "summary", 2);
    expect(next.get("show")).toBeNull();
    expect(next.get("page")).toBeNull();
    expect(next.get("version")).toBe("2");
    expect(next.get("q")).toBe("ada");
  });

  it("Responses sets show=responses, keeps the version and drops page", () => {
    const next = resultsViewParams(from("view=results&version=2&page=3&slot=Tue"), "responses", 2);
    expect(next.get("show")).toBe("responses");
    expect(next.get("version")).toBe("2");
    expect(next.get("view")).toBe("results");
    expect(next.get("page")).toBeNull();
    expect(next.get("slot")).toBe("Tue");
  });

  it("fills in the view and version when coming from Questions", () => {
    const next = resultsViewParams(from(""), "summary", 4);
    expect(next.get("view")).toBe("results");
    expect(next.get("version")).toBe("4");
  });
});

describe("ResultsSwitch", () => {
  it("is one control with three options, a count on Responses and the byline beside it", async () => {
    const onChange = vi.fn();
    await render(
      createElement(ResultsSwitch, {
        view: "summary",
        responseCount: 49,
        byline: "v3 · published by Ada, Nov 5, 2026",
        onChange,
      }),
    );
    const radios = [...container!.querySelectorAll("[role=radiogroup] [role=radio]")];
    expect(radios.map((r) => r.textContent)).toEqual(["Questions", "Summary", "Responses49"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(container!.textContent).toContain("v3 · published by Ada, Nov 5, 2026");
    await act(async () => void radios[2].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith("responses");
  });
});

describe("ExportCsvLink", () => {
  const link = () => container!.querySelector("a")!;

  it("reads Export when nothing narrows the file", async () => {
    await render(createElement(ExportCsvLink, { formId: "f1", versionNumber: 2, searchParams: new URLSearchParams() }));
    expect(link().textContent).toBe("Export");
    expect(link().getAttribute("href")).toBe("/forms/responses/f1/export.csv?version=2");
  });

  it("reads Export N and carries q, slot and answer filters when narrowed", async () => {
    await render(
      createElement(ExportCsvLink, {
        formId: "f1",
        versionNumber: 2,
        searchParams: new URLSearchParams("q=ada&slot=Tue&a=k:is:A"),
        matching: 7,
      }),
    );
    expect(link().textContent).toBe("Export 7");
    const href = new URL(link().getAttribute("href")!, "http://os.test");
    expect(href.searchParams.get("q")).toBe("ada");
    expect(href.searchParams.get("slot")).toBe("Tue");
    expect(href.searchParams.getAll("a")).toEqual(["k:is:A"]);
  });

  it("leaves the search out when the view has no search box", async () => {
    await render(
      createElement(ExportCsvLink, {
        formId: "f1",
        versionNumber: 2,
        searchParams: new URLSearchParams("q=ada"),
        search: false,
      }),
    );
    expect(link().getAttribute("href")).not.toContain("q=");
  });
});
