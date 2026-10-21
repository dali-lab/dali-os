// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { HiringNote } from "~/hiring/components/HiringNote";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let saved: Array<Record<string, unknown>>;

async function mount(props: { note: string | null; canEdit: boolean }) {
  saved = [];
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => createElement(HiringNote, props),
      action: async ({ request }) => {
        saved.push(Object.fromEntries(await request.formData()));
        return { ok: true };
      },
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function typeInto(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("HiringNote", () => {
  it("renders nothing for a reader when there is no note", async () => {
    await mount({ note: null, canEdit: false });
    expect(container.innerHTML).toBe("");
  });

  it("offers only a small Add note to an editor when there is no note", async () => {
    await mount({ note: null, canEdit: true });
    expect(button("Add note")).toBeTruthy();
    expect(container.querySelector("section")).toBeNull();
  });

  it("shows the note to a reader without an edit control", async () => {
    await mount({ note: "Submitted late, approved by Core.", canEdit: false });
    expect(container.textContent).toContain("Submitted late, approved by Core.");
    expect(container.querySelector('[aria-label="Edit note"]')).toBeNull();
  });

  it("saves a new note through the route action", async () => {
    await mount({ note: null, canEdit: true });
    await click(button("Add note")!);
    await typeInto(container.querySelector("textarea")!, "Emailed us before the deadline");
    await click(button("Save")!);
    expect(saved).toEqual([{ intent: "save-hiring-note", note: "Emailed us before the deadline" }]);
  });

  it("edits an existing note starting from its text", async () => {
    await mount({ note: "Old note", canEdit: true });
    await click(container.querySelector('[aria-label="Edit note"]')!);
    expect(container.querySelector("textarea")!.value).toBe("Old note");
  });

  it("cancel puts the note back unchanged", async () => {
    await mount({ note: "Old note", canEdit: true });
    await click(container.querySelector('[aria-label="Edit note"]')!);
    await typeInto(container.querySelector("textarea")!, "Changed");
    await click(button("Cancel")!);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Old note");
    expect(saved).toEqual([]);
  });
});
