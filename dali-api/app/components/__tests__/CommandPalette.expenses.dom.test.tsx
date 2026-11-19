// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommandPalette } from "../CommandPalette";
import type { RoleFlags } from "~/lib/nav-areas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => {};

let container: HTMLDivElement;
let root: Root;

function mount(props: { flags?: Record<string, boolean>; roles?: Partial<RoleFlags>; onOpen?: () => void }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const { roles, ...rest } = props;
  act(() =>
    root.render(
      createElement(CommandPalette, {
        open: true,
        onClose: () => {},
        focusMode: false,
        onOpen: () => {},
        ...rest,
        ...(roles ? { roles: { ...baseRoles, ...roles } } : {}),
      }),
    ),
  );
}

const baseRoles: RoleFlags = {
  isCore: false,
  isAdmin: false,
  isDomainLead: false,
  isInterviewer: false,
  canViewForms: false,
  canViewStaffing: false,
  hasHiringAccess: false,
  hasActiveHiringAccess: false,
  isLabMentor: false,
  isInstructor: false,
  isAlumni: false,
};

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const row = (title: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button[data-idx]")].find((b) => b.textContent?.includes(title));

describe("CommandPalette New expense", () => {
  it("is absent while the expenses flag is off", () => {
    mount({});
    expect(row("New expense")).toBeUndefined();
  });

  it("is absent for alumni", () => {
    mount({ flags: { expenses: true }, roles: { isAlumni: true } });
    expect(row("New expense")).toBeUndefined();
  });

  it("opens the Expenses page when the flag is on", () => {
    const onOpen = vi.fn();
    mount({ flags: { expenses: true }, roles: {}, onOpen });
    act(() => row("New expense")!.click());
    expect(onOpen).toHaveBeenCalledWith("/expenses", "Expenses", false);
  });
});
