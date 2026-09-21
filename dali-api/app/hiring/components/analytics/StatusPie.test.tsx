import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { StatusPie } from "./StatusPie";

describe("StatusPie SSR", () => {
  it("renders to a string under SSR without throwing (regression for #434)", () => {
    expect(() =>
      renderToString(
        createElement(StatusPie, {
          data: [
            { status: "Accepted", label: "Accepted", count: 3 },
            { status: "Rejected", label: "Rejected", count: 5 },
          ],
          selectedStatus: null,
          onSelect: () => {},
        }),
      ),
    ).not.toThrow();
  });

  it("renders the empty-state message when there are no applications", () => {
    const html = renderToString(
      createElement(StatusPie, {
        data: [{ status: "Accepted", label: "Accepted", count: 0 }],
        selectedStatus: null,
        onSelect: () => {},
      }),
    );
    expect(html).toContain("No applications match the current filter.");
  });
});
