// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { META_TONE_CLASS, MetaList } from "./MetaList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("MetaList tones", () => {
  it("draws urgent in the os warning amber and positive in the os green", () => {
    expect(META_TONE_CLASS.urgent).toContain("text-os-amber");
    expect(META_TONE_CLASS.positive).toContain("text-os-green");
  });

  it("uses no brand coral or teal, which sit outside the os palette", () => {
    for (const cls of Object.values(META_TONE_CLASS)) {
      expect(cls).not.toMatch(/accent-(coral|teal)/);
    }
  });

  it("renders each row's value with its tone", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(
        <MetaList
          rows={[
            { label: "Seats", value: "2 left", tone: "urgent" },
            { label: "Runs", value: "Oct 20" },
          ]}
        />,
      ),
    );
    const values = container.querySelectorAll("dd");
    expect(values[0].className).toBe(META_TONE_CLASS.urgent);
    expect(values[1].className).toBe(META_TONE_CLASS.default);
    act(() => root.unmount());
  });
});
