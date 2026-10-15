// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { LinkFormsModal } from "../TermFormStatus";
import { emptyDomainTermForms } from "../../lib/term-forms";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOMAINS = [
  { id: "dev", label: "Development (DEV)" },
  { id: "des", label: "Design (DES)" },
];
const FORMS = [
  { id: "f-dev", name: "Dev mentee" },
  { id: "f-des", name: "Design mentee" },
];

let container: HTMLDivElement;
let root: Root;
let posted: Record<string, string>[];
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  posted = [];
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(initialDomainId = "") {
  const dev = emptyDomainTermForms();
  dev.mentee.form = FORMS[0];
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () =>
        createElement(LinkFormsModal, {
          open: true,
          onClose: () => {},
          termId: "t1",
          domains: DOMAINS,
          initialDomainId,
          termForms: { dev },
          forms: FORMS,
        }),
      action: async ({ request }) => {
        posted.push(Object.fromEntries(await request.formData()) as Record<string, string>);
        return null;
      },
    },
  ]);
  act(() => root.render(createElement(Stub)));
}

const tab = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === name)!;
const trigger = (label: string) =>
  document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

describe("LinkFormsModal", () => {
  it("lists every domain as a tab and starts on the first", () => {
    render();
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["Development (DEV)", "Design (DES)"]);
    expect(tab("Development (DEV)").getAttribute("aria-selected")).toBe("true");
    expect(trigger("Mentee form").textContent).toContain("Dev mentee");
  });

  it("starts on the filtered domain", () => {
    render("des");
    expect(tab("Design (DES)").getAttribute("aria-selected")).toBe("true");
  });

  it("shows the selected domain's own forms", () => {
    render();
    act(() => tab("Design (DES)").click());
    expect(tab("Design (DES)").getAttribute("aria-selected")).toBe("true");
    expect(trigger("Mentee form").textContent).toContain("None");
  });

  it("links a form to the selected domain", async () => {
    render();
    act(() => tab("Design (DES)").click());
    act(() => trigger("Mentee form").click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === "Design mentee",
    )!;
    await act(async () => option.click());
    expect(posted).toEqual([
      { intent: "link-form", termId: "t1", domainId: "des", role: "mentee", formId: "f-des" },
    ]);
  });
});
