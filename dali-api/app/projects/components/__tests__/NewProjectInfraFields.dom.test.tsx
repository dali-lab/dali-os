// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NewProjectInfraFields } from "../NewProjectInfraFields";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLFormElement;
function render(targets: { neonOrgs: string[]; flyOrgs: string[] }) {
  container = document.createElement("form");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(NewProjectInfraFields, { targets })));
}
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

const box = (name: string) => container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const check = (name: string) => act(() => box(name).click());
const values = () => Object.fromEntries(new FormData(container).entries());

describe("NewProjectInfraFields", () => {
  it("asks for nothing by default", () => {
    render({ neonOrgs: ["org-dali-1"], flyOrgs: ["dali-os"] });
    expect(values()).toEqual({});
  });

  it("posts the Neon request with its default org once checked", () => {
    render({ neonOrgs: ["org-dali-1"], flyOrgs: ["dali-os"] });
    check("createNeon");
    expect(values()).toMatchObject({ createNeon: "on", neonOrgId: "org-dali-1", neonName: "" });
    expect(values()).not.toHaveProperty("createFly");
  });

  it("posts the Fly request once checked", () => {
    render({ neonOrgs: [], flyOrgs: ["dali-os"] });
    check("createFly");
    expect(values()).toMatchObject({ createFly: "on", flyOrgSlug: "dali-os", flyAppName: "" });
  });

  it("disables a provider with no org to create in and says why", () => {
    render({ neonOrgs: [], flyOrgs: [] });
    expect(box("createNeon").disabled).toBe(true);
    expect(box("createFly").disabled).toBe(true);
    expect(container.textContent).toContain("No Neon org is set on any project yet");
    expect(container.textContent).toContain("No project has a Fly write token yet");
  });

  it("states the starting compute range for Neon", () => {
    render({ neonOrgs: ["org-dali-1"], flyOrgs: [] });
    expect(container.textContent).toContain("Starts at 0.25 to 2 CU");
  });
});
