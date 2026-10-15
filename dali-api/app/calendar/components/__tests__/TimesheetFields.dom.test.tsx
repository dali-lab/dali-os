// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TimesheetFields } from "~/calendar/components/TimesheetFields";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(props: Partial<Parameters<typeof TimesheetFields>[0]> = {}) {
  const onIsWorkChange = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(TimesheetFields, {
        isWork: false,
        onIsWorkChange,
        roleKey: "",
        onRoleKeyChange: vi.fn(),
        roleOptions: [{ value: "r1", label: "Developer" }],
        workNote: "",
        onWorkNoteChange: vi.fn(),
        description: "Logs it.",
        fieldClass: "",
        ...props,
      }),
    ),
  );
  return { onIsWorkChange };
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TimesheetFields as a toggle (the edit composer)", () => {
  it("is the default: a switch labelled Add to timesheet inside its own well", () => {
    mount();
    expect(container.querySelector("input[role='switch']")).toBeTruthy();
    expect(container.querySelector("input[type='checkbox']:not([role])")).toBeNull();
    expect(container.textContent).toContain("Add to timesheet");
    expect(container.firstElementChild!.className).toContain("border");
  });

  it("reports the switch", () => {
    const { onIsWorkChange } = mount();
    act(() => (container.querySelector("input")! as HTMLInputElement).click());
    expect(onIsWorkChange).toHaveBeenCalledWith(true);
  });

  it("shows the role and note without indenting them", () => {
    mount({ isWork: true });
    expect(container.textContent).toContain("Role");
    expect(container.querySelector("textarea")).toBeTruthy();
    expect(container.querySelector(".pl-6")).toBeNull();
  });
});

describe("TimesheetFields as a checkbox row (the create modal)", () => {
  it("is a plain checkbox labelled Timesheet with its description, and brings no well of its own", () => {
    mount({ control: "checkbox" });
    expect(container.querySelector("input[role='switch']")).toBeNull();
    const label = container.querySelector("label")!;
    expect(label.textContent).toBe("TimesheetLogs it.");
    expect(label.querySelector("input[type='checkbox']")).toBeTruthy();
    expect(container.firstElementChild!.className).not.toContain("border");
  });

  it("is a default-size square checkbox", () => {
    mount({ control: "checkbox" });
    const box = container.querySelector("label > span")!;
    expect(box.className).toContain("h-4");
    expect(container.querySelector("label span[aria-hidden='true']")!.className).not.toContain("rounded-full");
  });

  it("reports the checkbox", () => {
    const { onIsWorkChange } = mount({ control: "checkbox", isWork: true });
    act(() => (container.querySelector("input")! as HTMLInputElement).click());
    expect(onIsWorkChange).toHaveBeenCalledWith(false);
  });

  it("hides the role and note while unchecked, and indents them under the label once checked", () => {
    mount({ control: "checkbox" });
    expect(container.querySelector("textarea")).toBeNull();
    act(() => root.unmount());
    container.remove();
    mount({ control: "checkbox", isWork: true });
    expect(container.querySelector("textarea")!.closest(".pl-6")).toBeTruthy();
    expect(container.textContent).toContain("Role");
  });
});
