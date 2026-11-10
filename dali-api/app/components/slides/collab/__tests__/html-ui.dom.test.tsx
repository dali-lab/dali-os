// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";
import { MAX_HTML_CHARS } from "~/components/slides/deck/content";
import { addSlide } from "~/components/slides/deck/deck-ops";
import { addHtml, addTextBox } from "~/components/slides/deck/freeform-ops";
import { initDeck } from "~/components/slides/deck/model";
import { snapshotDeck } from "~/components/slides/deck/snapshot";
import { HtmlSection } from "../ContentInspector";
import { IDLE, reduceEditing } from "../editing-model";
import { FreeformLayer, type FreeformLayerProps } from "../FreeformLayer";
import { INSERT_GROUPS } from "../InsertMenu";
import { elementTabLabel, type InspectorFreeform } from "../ElementInspector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function deck() {
  const doc = new Y.Doc();
  initDeck(doc);
  const slideId = addSlide(doc, "blank", null);
  const html = addHtml(doc, slideId, "<p>x</p>")!;
  const text = addTextBox(doc, slideId)!;
  return { doc, html, text, slide: () => snapshotDeck(doc).slides[0] };
}

describe("selecting and interacting with custom HTML", () => {
  const facts = (kinds: Record<string, string>) => ({ kindOf: (id: string) => kinds[id], locked: () => false });

  it("a click only selects it", () => {
    expect(reduceEditing(IDLE, { type: "click", id: "h" }, facts({ h: "html" }))).toEqual({ selection: ["h"], editingId: null, cropId: null });
  });

  it("double-click and Enter start interacting, and Esc goes back to selected", () => {
    const k = facts({ h: "html" });
    const inside = { selection: ["h"], editingId: "h", cropId: null };
    expect(reduceEditing(IDLE, { type: "dblclick", id: "h" }, k)).toEqual(inside);
    expect(reduceEditing({ selection: ["h"], editingId: null, cropId: null }, { type: "enter" }, k)).toEqual(inside);
    expect(reduceEditing(inside, { type: "escape" }, k)).toEqual({ selection: ["h"], editingId: null, cropId: null });
    expect(reduceEditing(inside, { type: "background" }, k)).toEqual(IDLE);
  });

  it("does not interact with a locked one", () => {
    expect(reduceEditing(IDLE, { type: "dblclick", id: "h" }, { kindOf: () => "html", locked: () => true }).editingId).toBeNull();
  });

  function layer(editingId: string | null) {
    const d = deck();
    const props: FreeformLayerProps = {
      slide: d.slide(),
      selection: [d.html],
      onSelect: vi.fn(),
      editingId,
      onEdit: vi.fn(),
      prefs: { items: true, margins: true, grid: false },
      armed: null,
      onPlace: vi.fn(),
      onLive: vi.fn(),
      onCommit: vi.fn(),
      onActivate: vi.fn(),
    };
    act(() => root.render(createElement(FreeformLayer, props)));
    return { d, props, hit: container.querySelector<HTMLElement>(`[data-hit="${d.html}"]`)! };
  }

  it("catches the pointer over an unselected or selected frame, so clicks select instead of reaching it", () => {
    const { hit, props, d } = layer(null);
    expect(hit.className).not.toContain("pointer-events-none");
    expect(hit.className).toContain("cursor-move");
    act(() => void hit.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(props.onActivate).toHaveBeenCalledWith(d.html, expect.any(Object));
  });

  it("lets pointer events through to the frame while interacting", () => {
    const d = deck();
    act(() =>
      root.render(
        createElement(FreeformLayer, {
          slide: d.slide(),
          selection: [d.html],
          editingId: d.html,
          onSelect: vi.fn(),
          onEdit: vi.fn(),
          prefs: { items: true, margins: true, grid: false },
          armed: null,
          onPlace: vi.fn(),
          onLive: vi.fn(),
          onCommit: vi.fn(),
          onActivate: vi.fn(),
        }),
      ),
    );
    expect(container.querySelector(`[data-hit="${d.html}"]`)!.className).toContain("pointer-events-none");
  });
});

describe("Insert menu", () => {
  it("offers Custom HTML", () => {
    const entries = INSERT_GROUPS.flat();
    expect(entries.find((e) => e.label === "Custom HTML")?.item).toEqual({ type: "html" });
  });
});

describe("HtmlSection", () => {
  function mount(html: string, over: Partial<InspectorFreeform> = {}, editable = true) {
    const d = deck();
    const freeform = {
      onHtml: vi.fn(() => true),
      onHtmlFill: vi.fn(),
      onInteract: vi.fn(),
      interactingId: null,
      ...over,
    } as unknown as InspectorFreeform;
    const element = { ...d.slide().elements.find((e) => e.id === d.html)!, html };
    act(() => root.render(createElement(HtmlSection, { element, editable, freeform })));
    return { freeform, element };
  }
  const area = () => container.querySelector("textarea")!;
  const type = (value: string) =>
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(area(), value);
      area().dispatchEvent(new Event("input", { bubbles: true }));
    });
  const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === name)!;

  it("writes what is typed to the shared text", () => {
    const { freeform, element } = mount("<p>a</p>");
    expect(area().value).toBe("<p>a</p>");
    type("<p>ab</p>");
    expect(freeform.onHtml).toHaveBeenCalledWith(element.id, "<p>ab</p>");
  });

  it("heads the editor Source once, keeping the box labelled for screen readers", () => {
    mount("<p>a</p>");
    expect([...container.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Source"]);
    const label = area().closest("label")!.querySelector("span")!;
    expect(label.textContent).toBe("Source");
    expect(label.className).toContain("sr-only");
  });

  it("names the inspector tab HTML so it fits", () => {
    const d = deck();
    expect(elementTabLabel(d.slide(), [d.html])).toBe("HTML");
  });

  it("inserts two spaces on Tab and leaves the box on Esc", () => {
    const { freeform, element } = mount("x");
    area().focus();
    area().setSelectionRange(1, 1);
    act(() => void area().dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(freeform.onHtml).toHaveBeenCalledWith(element.id, "x  ");
    act(() => void area().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).not.toBe(area());
  });

  it("says so when a change is refused for size", () => {
    mount("<p>a</p>", { onHtml: vi.fn(() => false) });
    type("<p>b</p>");
    expect(container.querySelector("[role=alert]")!.textContent).toContain(`${MAX_HTML_CHARS / 1000} KB`);
  });

  it("takes in a change from a peer", () => {
    const d = deck();
    const freeform = { onHtml: vi.fn(() => true), onHtmlFill: vi.fn(), onInteract: vi.fn(), interactingId: null } as unknown as InspectorFreeform;
    const base = d.slide().elements.find((e) => e.id === d.html)!;
    act(() => root.render(createElement(HtmlSection, { element: { ...base, html: "one" }, editable: true, freeform })));
    act(() => root.render(createElement(HtmlSection, { element: { ...base, html: "two" }, editable: true, freeform })));
    expect(area().value).toBe("two");
  });

  it("offers Fill slide, Reload and Interact", () => {
    const { freeform, element } = mount("<p>a</p>");
    act(() => void container.querySelector<HTMLInputElement>("input[type=checkbox]")!.click());
    expect(freeform.onHtmlFill).toHaveBeenCalledWith(element.id, true);
    act(() => void button("Interact").click());
    expect(freeform.onInteract).toHaveBeenCalledWith(element.id);
    expect(button("Reload")).toBeTruthy();
    expect(container.textContent).toContain("Fill slide");
  });

  it("describes what the sandbox allows the way the policy does", () => {
    mount("<p>a</p>");
    expect(container.textContent).not.toContain("no network access");
    expect(container.textContent).toContain("can't send requests");
    for (const host of ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com"]) expect(container.textContent).toContain(host);
  });

  it("offers to stop interacting while it is on", () => {
    const { freeform, element } = mount("<p>a</p>", { interactingId: "x" });
    expect(button("Interact")).toBeTruthy();
    act(() => root.render(createElement(HtmlSection, { element, editable: true, freeform: { ...freeform, interactingId: element.id } })));
    expect(button("Stop interacting")).toBeTruthy();
  });
});
