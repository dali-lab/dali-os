// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parsePlacedFields, type PlacedField } from "~/education/lib/certificate-fields";
import { CertificateTemplateEditor } from "../CertificateTemplateEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const legacy: PlacedField = { key: "studentName", x: 0.5, y: 0.5, fontSize: 40, color: "#1c2b4a", align: "center", bold: true };
const box: PlacedField = { key: "offeringTitle", x: 0.1, y: 0.1, w: 0.4, fontSize: 30, color: "#000000", align: "left", bold: false, fit: "wrap" };

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 500, height: 400, right: 500, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(initialFields: PlacedField[], background: { bgUrl: string | null; bgIssue?: "pdf" | "unsupported" | null } = { bgUrl: "/bg.png" }) {
  act(() => root.render(createElement(CertificateTemplateEditor, { templateId: "t1", ...background, bgWidth: 1000, bgHeight: 800, initialFields })));
}
const hit = (key: string) => container.querySelector<HTMLElement>(`[data-hit="${key}"]`);
const stage = () => container.querySelector<HTMLElement>("[data-certificate-stage]")!;
const fire = (target: EventTarget, type: string, init: MouseEventInit = {}) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  });
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    stage().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  });
const click = (label: string) =>
  act(() => {
    [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!.click();
  });
function select(k: string) {
  const el = hit(k)!;
  fire(el, "pointerdown", { clientX: 250, clientY: 215 });
  fire(window, "pointerup", { clientX: 250, clientY: 215 });
}
const left = (k: string) => parseFloat(hit(k)!.style.left);
const savedFields = (i = 0) => parsePlacedFields(JSON.parse(new URLSearchParams(fetchMock.mock.calls[i][1].body).get("fields")!));

describe("CertificateTemplateEditor", () => {
  it("opens a legacy anchor field as a box without moving its anchor", () => {
    mount([legacy]);
    expect(left("studentName")).toBeCloseTo(15);
    expect(parseFloat(hit("studentName")!.style.width)).toBeCloseTo(70);
    act(() => vi.advanceTimersByTime(3000));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds a field as a selected, centred box with the right default fit", () => {
    mount([]);
    click("Student name");
    expect(hit("studentName")).not.toBeNull();
    expect(container.querySelector("[data-selection-frame]")).not.toBeNull();
    expect(container.querySelector("[aria-label='Text fit'] [aria-checked='true']")!.textContent).toBe("Shrink");
    click("Course title");
    expect(container.querySelector("[aria-label='Text fit'] [aria-checked='true']")!.textContent).toBe("Wrap");
  });

  it("commits a drag as fractions of the page", () => {
    mount([box]);
    const el = hit("offeringTitle")!;
    fire(el, "pointerdown", { clientX: 100, clientY: 60 });
    fire(window, "pointermove", { clientX: 140, clientY: 60 });
    fire(window, "pointerup", { clientX: 140, clientY: 60 });
    expect(left("offeringTitle")).toBeCloseTo(18);
    act(() => vi.advanceTimersByTime(800));
    expect(savedFields()[0]).toMatchObject({ key: "offeringTitle", x: 0.18, w: 0.4 });
  });

  it("resizes only the width from a side handle", () => {
    mount([box]);
    select("offeringTitle");
    const handles = [...container.querySelectorAll("[data-handle]")].map((h) => h.getAttribute("data-handle")).sort();
    expect(handles).toEqual(["e", "w"]);
  });

  it("nudges the selection with the arrow keys, ten at a time with shift", () => {
    mount([box]);
    select("offeringTitle");
    key("ArrowRight");
    expect(left("offeringTitle")).toBeCloseTo(10.1);
    key("ArrowRight", { shiftKey: true });
    expect(left("offeringTitle")).toBeCloseTo(11.1);
  });

  it("deletes the selection and brings it back with undo and redo", () => {
    mount([box]);
    select("offeringTitle");
    key("Delete");
    expect(hit("offeringTitle")).toBeNull();
    key("z", { metaKey: true });
    expect(hit("offeringTitle")).not.toBeNull();
    key("z", { metaKey: true, shiftKey: true });
    expect(hit("offeringTitle")).toBeNull();
  });

  it("clears the selection on Escape", () => {
    mount([box]);
    select("offeringTitle");
    key("Escape");
    expect(container.querySelector("[data-selection-frame]")).toBeNull();
  });

  it("ignores keys typed into an input", () => {
    mount([box]);
    select("offeringTitle");
    const input = container.querySelector("input[aria-label='Font size']") as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    });
    expect(hit("offeringTitle")).not.toBeNull();
  });

  it("selects several fields with shift-click and aligns them to each other", () => {
    mount([box, { ...box, key: "dateRange", x: 0.3, y: 0.6 }]);
    select("offeringTitle");
    fire(hit("dateRange")!, "pointerdown", { clientX: 250, clientY: 250, shiftKey: true });
    fire(window, "pointerup", { clientX: 250, clientY: 250 });
    expect(container.querySelectorAll("[data-handle]").length).toBe(0);
    click("Each other");
    act(() => {
      (container.querySelector("button[aria-label='Align left']") as HTMLButtonElement).click();
    });
    act(() => vi.advanceTimersByTime(800));
    const [a, b] = savedFields();
    expect(a.x).toBeCloseTo(b.x);
  });

  it("aligns a single field to the page", () => {
    mount([box]);
    select("offeringTitle");
    act(() => {
      (container.querySelector("button[aria-label='Align center']") as HTMLButtonElement).click();
    });
    act(() => vi.advanceTimersByTime(800));
    expect(savedFields()[0].x).toBeCloseTo(0.3);
  });

  it("edits style from the format bar and autosaves the parsed fields", () => {
    mount([box]);
    select("offeringTitle");
    click("Shrink");
    act(() => vi.advanceTimersByTime(800));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get("intent")).toBe("save-fields");
    expect(savedFields()).toEqual([{ ...box, fit: "shrink" }]);
  });

  it("removes the selected field from the side panel", () => {
    mount([box]);
    select("offeringTitle");
    click("Remove field");
    expect(hit("offeringTitle")).toBeNull();
  });

  it("remembers snap preferences under the certificate key", () => {
    mount([box]);
    act(() => {
      (container.querySelector("input[type='checkbox'][role='switch']") as HTMLInputElement).click();
    });
    expect(JSON.parse(window.localStorage.getItem("dali.certificates.snap")!).items).toBe(false);
    expect(window.localStorage.getItem("dali.slides.snap")).toBeNull();
  });

  it("tells the editor that saving restyles issued certificates", () => {
    mount([box]);
    expect(container.textContent).toContain("restyles every certificate already issued");
  });

  it("shows the background image when there is one", () => {
    mount([box]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/bg.png");
    expect(container.querySelector("[data-background-issue]")).toBeNull();
  });

  it("asks for a PNG or JPG instead of a broken image when the background is a PDF", () => {
    mount([box], { bgUrl: null, bgIssue: "pdf" });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-background-issue]")?.textContent).toBe("This background is a PDF. Export it as a PNG or JPG and replace it in Drive.");
    expect(hit("offeringTitle")).not.toBeNull();
  });

  it("names any other unsupported background generically", () => {
    mount([box], { bgUrl: null, bgIssue: "unsupported" });
    expect(container.querySelector("[data-background-issue]")?.textContent).toBe("This background isn't a PNG or JPG. Replace it in Drive with a PNG or JPG.");
  });
});
