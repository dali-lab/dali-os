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
      Item: ({
        children,
        onSelect,
        disabled,
        checked,
      }: {
        children: React.ReactNode;
        onSelect?: () => void;
        disabled?: boolean;
        checked?: boolean;
      }) =>
        createElement("button", { onClick: onSelect, disabled, "data-item": "", "aria-checked": checked }, children),
      Sub: ({ label, children }: { label: string; children: React.ReactNode }) =>
        createElement("div", { "data-sub": label }, children),
      Separator: () => null,
    },
  ),
}));
const prompt = vi.fn();
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ prompt }) }));
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

  const controls = (over: Partial<ColumnControls> = {}): ColumnControls => ({
    available: [{ key: "member:hiredRoles", label: "Hired roles" }],
    edit: vi.fn(),
    ...over,
  });
  const items = (menu: string) =>
    [...container.querySelectorAll(`[data-menu='${menu}'] [data-item]`)] as HTMLButtonElement[];
  const item = (menu: string, text: string) => items(menu).find((b) => b.textContent === text)!;

  it("+ shows a column that isn't in the table", async () => {
    const c = controls();
    await render({ controls: c });
    await click(item("Add a column", "Hired roles"));
    expect(c.edit).toHaveBeenCalledWith({ op: "show", id: "member:hiredRoles" });
  });

  it("says so when every column is added", async () => {
    await render({ controls: controls({ available: [] }) });
    const only = items("Add a column")[0];
    expect(only.textContent).toBe("Every column is added");
    expect(only.disabled).toBe(true);
  });

  it("each column's menu hides and moves it, with the ends disabled", async () => {
    const c = controls();
    await render({ controls: c });
    expect(item("Coming back column", "Move left").disabled).toBe(true);
    expect(item("Terms in lab column", "Move right").disabled).toBe(true);
    await click(item("Coming back column", "Move right"));
    expect(c.edit).toHaveBeenCalledWith({ op: "move", id: "q1", dir: 1 });
    await click(item("Terms in lab column", "Hide column"));
    expect(c.edit).toHaveBeenCalledWith({ op: "hide", id: "member:termsInLab" });
  });

  it("renames through the prompt, trimmed, and does nothing when cancelled or unchanged", async () => {
    const c = controls();
    await render({ controls: c });
    prompt.mockResolvedValueOnce("  When  ");
    await click(item("Coming back column", "Rename"));
    expect(c.edit).toHaveBeenCalledWith({ op: "rename", id: "q1", label: "When" });
    prompt.mockResolvedValueOnce(null);
    await click(item("Coming back column", "Rename"));
    prompt.mockResolvedValueOnce("Coming back");
    await click(item("Coming back column", "Rename"));
    expect(c.edit).toHaveBeenCalledTimes(1);
  });

  it("adds a column's extra items to its menu", async () => {
    const onSelect = vi.fn();
    await render({
      controls: controls({ extraItems: (key) => (key === "q1" ? [{ label: "Status answers", onSelect }] : []) }),
    });
    expect(items("Terms in lab column").map((b) => b.textContent)).not.toContain("Status answers");
    await click(item("Coming back column", "Status answers"));
    expect(onSelect).toHaveBeenCalled();
  });

  it("offers Feeds staffing as only where the table gives a role menu", async () => {
    const onRole = vi.fn();
    await render({
      controls: controls({
        roleMenu: (key) =>
          key === "q1"
            ? { choices: [{ value: "display", label: "Nothing, just show it" }, { value: "project", label: "Project" }], value: "display" }
            : null,
        onRole,
      }),
    });
    expect(container.querySelectorAll("[data-sub='Feeds staffing as']")).toHaveLength(1);
    expect(item("Coming back column", "Nothing, just show it").getAttribute("aria-checked")).toBe("true");
    await click(item("Coming back column", "Nothing, just show it"));
    expect(onRole).not.toHaveBeenCalled();
    await click(item("Coming back column", "Project"));
    expect(onRole).toHaveBeenCalledWith("q1", "project");
  });
});
