// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { ManagedEditorShell } from "./ManagedEditorShell";
import { PageBarSlotProvider, usePageBarTargetSetters } from "~/components/shell/page-bar-slot";
import { OverflowMenu } from "~/components/shell/OverflowMenu";
import { DialogProvider } from "~/components/ui/dialog";
import { Menu } from "~/components/ui/floating";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const posted: Record<string, string>[] = [];

function Bar() {
  const { statusRef, actionsRef } = usePageBarTargetSetters();
  return createElement(
    "header",
    null,
    createElement("div", { "data-testid": "status", ref: statusRef }),
    createElement("div", { "data-testid": "actions", ref: actionsRef }),
    createElement(OverflowMenu),
  );
}

async function mount(props: Record<string, unknown> = {}) {
  const Stub = createRoutesStub([
    {
      path: "*",
      action: async ({ request }) => {
        posted.push(Object.fromEntries(await request.formData()) as Record<string, string>);
        return null;
      },
      Component: () =>
        createElement(
          DialogProvider,
          null,
          createElement(PageBarSlotProvider, {
            children: createElement(
              "div",
              null,
              createElement(Bar),
              createElement(
                ManagedEditorShell,
                {
                  name: "Mentor agreement",
                  status: "v4 · In force",
                  headerActions: createElement("button", { type: "button" }, "New version"),
                  menuItems: createElement(Menu.Item, null, "Archive"),
                  rename: { name: "Mentor agreement", renameIntent: "rename" },
                  metaBadges: createElement("span", null, "slug: mentor"),
                  ...props,
                },
                createElement("p", null, "body"),
              ),
            ),
          }),
        ),
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/core/agreements/a1"] }));
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  posted.length = 0;
  vi.restoreAllMocks();
});

describe("ManagedEditorShell", () => {
  it("has no in-page title", async () => {
    await mount();
    expect(container.querySelector("h1")).toBeNull();
    expect(container.textContent).not.toContain("Mentor agreement");
  });

  it("puts the status and actions in the page bar and keeps meta badges in the body", async () => {
    await mount();
    expect(container.querySelector("[data-testid=status]")!.textContent).toBe("v4 · In force");
    expect(container.querySelector("[data-testid=actions]")!.textContent).toBe("New version");
    expect(container.textContent).toContain("slug: mentor");
  });

  it("lists Rename then the page's own rows in the overflow", async () => {
    await mount();
    await act(async () => container.querySelector<HTMLElement>("[aria-label='More actions']")!.click());
    expect([...document.body.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent)).toEqual(["Rename", "Archive"]);
  });

  it("offers no Rename without a rename config", async () => {
    await mount({ rename: undefined });
    await act(async () => container.querySelector<HTMLElement>("[aria-label='More actions']")!.click());
    expect([...document.body.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent)).toEqual(["Archive"]);
  });
});
