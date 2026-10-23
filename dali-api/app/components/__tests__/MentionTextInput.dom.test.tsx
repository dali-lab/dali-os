// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MentionTextInput } from "../MentionTextInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ members: [{ id: "u1", name: "Leo Brennan", handle: "leo_b" }] }),
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Harness({ dropUp }: { dropUp?: boolean }) {
  const [value, setValue] = useState("");
  return <MentionTextInput value={value} onChange={setValue} ariaLabel="Add a comment" dropUp={dropUp} />;
}

async function typeAt(dropUp?: boolean) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness dropUp={dropUp} />));
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "hi @le");
    input.setSelectionRange(6, 6);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

const dropdown = () =>
  [...container.querySelectorAll("div")].find((d) => d.textContent?.includes("@leo_b") && d.className.includes("absolute"));

describe("MentionTextInput", () => {
  it("names the field for assistive tech", async () => {
    const input = await typeAt();
    expect(input.getAttribute("aria-label")).toBe("Add a comment");
  });

  // .os-form dresses input[type="text"] only; an untyped input renders bare.
  it("is a typed text input so form styles reach it", async () => {
    const input = await typeAt();
    expect(input.getAttribute("type")).toBe("text");
  });

  it("opens suggestions below the field by default", async () => {
    await typeAt();
    expect(dropdown()?.className).toContain("top-full");
  });

  it("opens them above the field with dropUp", async () => {
    await typeAt(true);
    const d = dropdown()!;
    expect(d.className).toContain("bottom-full");
    expect(d.className).not.toContain("top-full");
  });
});
