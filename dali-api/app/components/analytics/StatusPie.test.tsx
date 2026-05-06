import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// react-router's hooks need a router context at runtime; for an SSR smoke test
// we just need them to not throw.
vi.mock("react-router", () => ({
  useNavigate: () => () => {},
  useSearchParams: () => [new URLSearchParams(), () => {}],
}));

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
        }),
      ),
    ).not.toThrow();
  });

  it("renders the empty-state message when there are no applications", () => {
    const html = renderToString(
      createElement(StatusPie, {
        data: [{ status: "Accepted", label: "Accepted", count: 0 }],
        selectedStatus: null,
      }),
    );
    expect(html).toContain("No applications match the current filter.");
  });
});
