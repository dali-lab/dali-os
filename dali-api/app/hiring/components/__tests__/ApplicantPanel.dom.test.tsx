// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApplicantPanel } from "../ApplicantPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(props: Partial<Parameters<typeof ApplicantPanel>[0]>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(ApplicantPanel, {
        title: "Past DALI education",
        subtitle: "2 offerings",
        footer: "Hidden during blind review.",
        ...props,
        children: createElement("li", null, "Intro to Design"),
      }),
    );
  });
  return host;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("ApplicantPanel", () => {
  it("shows its rows open by default with a plain, non-toggling title", async () => {
    const el = await mount({});
    expect(el.textContent).toContain("Intro to Design");
    expect(el.textContent).toContain("Hidden during blind review.");
    expect(el.querySelector("button")).toBeNull();
  });

  it("starts folded to the title and subtitle when defaultOpen is false", async () => {
    const el = await mount({ defaultOpen: false });
    const toggle = el.querySelector("button")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(el.textContent).toContain("Past DALI education");
    expect(el.textContent).toContain("2 offerings");
    expect(el.textContent).not.toContain("Intro to Design");
    expect(el.textContent).not.toContain("Hidden during blind review.");
  });

  it("opens and closes again from the title", async () => {
    const el = await mount({ defaultOpen: false });
    const toggle = el.querySelector("button")!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(el.textContent).toContain("Intro to Design");
    await act(async () => toggle.click());
    expect(el.textContent).not.toContain("Intro to Design");
  });
});
