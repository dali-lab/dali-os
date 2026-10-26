// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MentionTextInput } from "../MentionTextInput";
import { mentionUserCache } from "~/lib/mention-search";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mentionUserCache.clear();
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

function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function typeAt(dropUp?: boolean) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness dropUp={dropUp} />));
  const input = container.querySelector("input")!;
  await act(async () => {
    typeInto(input, "hi @le");
    await new Promise((resolve) => setTimeout(resolve, 200));
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

  it("shows suggestions for a query it has already searched before the network answers", async () => {
    const input = await typeAt();
    await act(async () => typeInto(input, "hi"));
    expect(dropdown()).toBeUndefined();

    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    await act(async () => typeInto(input, "hi @le"));
    expect(dropdown()?.textContent).toContain("@leo_b");
  });
});
