/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { renderDom } from "~/test-utils/render";
import { StatusSegment } from "~/projects/components/detail/DetailsSegments";

describe("StatusSegment", () => {
  it("shows the status badge to members who can't edit", async () => {
    const Stub = createRoutesStub([
      { path: "/", Component: () => createElement(StatusSegment, { status: "Paused", canEdit: false }) },
    ]);
    const { container } = renderDom(createElement(Stub, { initialEntries: ["/"] }));
    await act(async () => {});
    expect(container.textContent).toContain("Paused");
  });
});
