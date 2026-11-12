// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const submit = vi.fn();
const confirm = vi.fn();
vi.mock("react-router", () => ({
  useFetcher: () => ({ submit, state: "idle", data: undefined, formData: undefined }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => createElement("a", { href: to }, children),
}));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm }) }));
vi.mock("~/components/ui/toast", () => ({ useToast: () => Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("~/components/ui/IconButton", () => ({
  IconButton: ({ label }: { label: string }) => createElement("button", { "aria-label": label }),
}));
vi.mock("~/components/ui/floating", () => ({
  Menu: Object.assign(
    ({ trigger, children }: { trigger: React.ReactNode; children: React.ReactNode }) =>
      createElement("div", { "data-menu": "" }, trigger, children),
    {
      Item: ({ children, onSelect, checked }: { children: React.ReactNode; onSelect?: () => void; checked?: boolean }) =>
        createElement("button", { onClick: onSelect, "data-item": "", "aria-checked": checked }, children),
      LinkItem: ({ children, to }: { children: React.ReactNode; to: string }) =>
        createElement("a", { href: to, "data-link": "" }, children),
      Sub: ({ label, children }: { label: string; children: React.ReactNode }) =>
        createElement("div", { "data-sub": label }, children),
      Separator: () => null,
    },
  ),
}));

import { BoardSettings } from "../BoardSettings";

const BINDING = { formId: "f1", formName: "Bids form", published: true, gateAudience: null };
const FORMS = [
  { id: "f1", name: "Bids form", published: true },
  { id: "f2", name: "Old bids", published: false, boundToCycleName: "26S Staffing" },
];

let container: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
  submit.mockClear();
  confirm.mockReset();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
});

async function render(props: Partial<Parameters<typeof BoardSettings>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(BoardSettings, {
        slotLabel: "Project Bids",
        binding: BINDING,
        forms: FORMS,
        canManage: true,
        ...props,
      }),
    ),
  );
}
const item = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("[data-item]")].find((b) => b.textContent?.startsWith(text))!;
const click = (el: HTMLElement) => act(async () => el.click());

describe("BoardSettings", () => {
  it("closes and reopens submissions", async () => {
    await render();
    expect(item("Open for submissions").getAttribute("aria-checked")).toBe("true");
    await click(item("Open for submissions"));
    expect(submit).toHaveBeenCalledWith({ intent: "set-slot-published", published: "0" }, { method: "post" });
  });

  it("locks the app for an audience and shows it in the line", async () => {
    await render({ binding: { ...BINDING, gateAudience: "Mentors" } });
    expect(container.textContent).toContain("Locks the app for mentors (staffed this term)");
    await click(item("Don't lock the app"));
    expect(submit).toHaveBeenCalledWith({ intent: "set-slot-gate", gateAudience: "" }, { method: "post" });
  });

  it("switches to another form directly", async () => {
    await render({ forms: [...FORMS, { id: "f3", name: "New bids", published: true }] });
    await click(item("New bids"));
    expect(confirm).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith({ intent: "set-slot-form", formId: "f3" }, { method: "post" });
  });

  it("asks before moving a form off another term, and doesn't when declined", async () => {
    await render();
    confirm.mockResolvedValueOnce(false);
    await click(item("Old bids"));
    expect(submit).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(true);
    await click(item("Old bids"));
    expect(submit).toHaveBeenCalledWith({ intent: "set-slot-form", formId: "f2", allowMove: "1" }, { method: "post" });
  });

  it("offers Send to members only while open", async () => {
    await render();
    expect(container.textContent).toContain("Send to members");
    act(() => root!.unmount());
    root = undefined;
    container.remove();
    await render({ binding: { ...BINDING, published: false } });
    expect(container.textContent).toContain("Closed");
    expect(container.textContent).not.toContain("Send to members");
  });

  it("with no form, offers only Connect a form", async () => {
    await render({ binding: null });
    expect(container.textContent).toContain("No Project Bids form is connected for this term.");
    expect(container.querySelector("[data-sub='Connect a form']")).not.toBeNull();
    expect(container.textContent).not.toContain("Open for submissions");
  });

  it("gives viewers no menu", async () => {
    await render({ canManage: false });
    expect(container.textContent).toContain("Collecting with Bids form");
    expect(container.querySelector("[data-menu]")).toBeNull();
  });
});
