// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", () => ({
  Menu: Object.assign(
    ({ trigger, children, ariaLabel }: { trigger: React.ReactNode; children: React.ReactNode; ariaLabel: string }) =>
      createElement("div", { "data-menu": ariaLabel }, trigger, children),
    {
      Item: ({ children, onSelect, disabled }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean }) =>
        createElement("button", { onClick: onSelect, disabled, "data-item": "" }, children),
    },
  ),
}));
vi.mock("~/components/ui/IconButton", () => ({
  IconButton: ({ label }: { label: string }) => createElement("button", { "aria-label": label }),
}));

import { ResponseTable, type ColumnControls } from "~/forms/components/ResponseTable";

let container: HTMLDivElement;
let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
});

type Row = { id: string; name: string; cells: Record<string, string> };
const rows: Row[] = [{ id: "r1", name: "Ada", cells: { q1: "Yes" } }];

async function render(props: { controls?: ColumnControls | null; onOpen?: (r: Row) => void; onAction?: () => void }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(ResponseTable<Row>, {
        lead: [{ key: "name", label: "Member", cell: (r) => r.name }],
        columns: [
          { key: "q1", label: "Coming back" },
          { key: "member:termsInLab", label: "Terms in lab" },
        ],
        trailing: [
          { key: "act", label: "Actions", cell: () => createElement("button", { onClick: props.onAction }, "Do it") },
        ],
        rows,
        rowKey: (r) => r.id,
        value: (r, key) => r.cells[key] ?? "",
        onOpen: props.onOpen ?? (() => {}),
        controls: props.controls,
      }),
    ),
  );
}

const headers = () => [...container.querySelectorAll("th")].map((th) => th.textContent);
const click = (el: Element | null) => act(() => (el as HTMLElement).click());

describe("ResponseTable", () => {
  it("renders lead, data and trailing columns, with a dash for blank cells", async () => {
    await render({});
    expect(headers()).toEqual(["Member", "Coming back", "Terms in lab", "Actions"]);
    expect([...container.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["Ada", "Yes", "—", "Do it"]);
    expect(container.querySelector("[aria-label='Add a column']")).toBeNull();
  });

  it("opens a row on click but not from a trailing action", async () => {
    const onOpen = vi.fn();
    const onAction = vi.fn();
    await render({ onOpen, onAction });
    await click(container.querySelector("td"));
    expect(onOpen).toHaveBeenCalledWith(rows[0]);
    await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Do it")!);
    expect(onAction).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("with controls, offers available columns and removes removable ones", async () => {
    const controls: ColumnControls = {
      available: [{ key: "hiredRoles", label: "Hired roles" }],
      onAdd: vi.fn(),
      removable: (key) => key.startsWith("member:"),
      onRemove: vi.fn(),
    };
    await render({ controls });
    expect(container.querySelector("[aria-label='Add a column']")).not.toBeNull();
    const items = () => [...container.querySelectorAll("[data-item]")] as HTMLButtonElement[];
    await click(items().find((b) => b.textContent === "Hired roles")!);
    expect(controls.onAdd).toHaveBeenCalledWith("hiredRoles");
    expect(container.querySelector("[data-menu='Coming back column']")).toBeNull();
    await click(container.querySelector("[data-menu='Terms in lab column'] [data-item]"));
    expect(controls.onRemove).toHaveBeenCalledWith("member:termsInLab");
  });

  it("says so when every column is added", async () => {
    await render({ controls: { available: [], onAdd: vi.fn(), removable: () => false, onRemove: vi.fn() } });
    const item = container.querySelector("[data-menu='Add a column'] [data-item]") as HTMLButtonElement;
    expect(item.textContent).toBe("Every column is added");
    expect(item.disabled).toBe(true);
  });
});
