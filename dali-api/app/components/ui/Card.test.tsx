// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Card } from "./Card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Card", () => {
  it("draws the borderless os panel and passes through className and props", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<Card className="p-8" data-testid="c">Hi</Card>));
    const el = container.querySelector("[data-testid='c']")!;
    expect(el.classList.contains("rounded-os-card")).toBe(true);
    expect(el.classList.contains("bg-card")).toBe(true);
    expect(el.classList.contains("p-8")).toBe(true);
    expect(el.className).not.toMatch(/\bborder\b/);
    expect(el.textContent).toBe("Hi");
    act(() => root.unmount());
  });
});
