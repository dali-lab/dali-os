// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { PlanningApplicationModal } from "../PlanningApplicationModal";
import type { PlanningApplicationInfo } from "~/partners/lib/planning-gap.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let posted: FormData[];

async function mount(info: PlanningApplicationInfo, canEdit = true) {
  posted = [];
  const Page = () => createElement(PlanningApplicationModal, { applicationId: "a1", info, canEdit, onClose: () => {} });
  const Stub = createRoutesStub([
    { path: "/", Component: Page, loader: () => null },
    {
      path: "/core/partners/planning",
      action: async ({ request }) => {
        posted.push(await request.formData());
        return { ok: true };
      },
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Stub, { initialEntries: ["/"] })));
  await act(async () => {});
}

const info: PlanningApplicationInfo = {
  title: "Beacon",
  iconEmoji: null,
  stage: "Interview",
  partnerName: "Acme",
  note: null,
  continues: null,
};

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PlanningApplicationModal", () => {
  it("shows the stage and partner, and links to the board card", async () => {
    await mount(info);
    expect(document.body.textContent).toContain("Beacon");
    expect(document.body.textContent).toContain("Acme");
    expect(document.body.textContent).toContain("Interview");
    const link = Array.from(document.body.querySelectorAll("a")).find((a) => a.textContent?.includes("Partners board"));
    expect(link?.getAttribute("href")).toBe("/core/partners?application=a1");
  });

  it("posts a new note for the application", async () => {
    await mount(info);
    const textarea = document.body.querySelector<HTMLTextAreaElement>("textarea[aria-label='Planning notes']")!;
    expect(textarea.value).toBe("");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Call Tuesday");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      Array.from(document.body.querySelectorAll("button"))
        .find((b) => b.textContent === "Save notes")!
        .click(),
    );
    expect(Object.fromEntries(posted[0])).toEqual({
      intent: "note",
      ownerKind: "application",
      ownerId: "a1",
      body: "Call Tuesday",
    });
  });

  it("shows the note read-only without a textarea", async () => {
    await mount({ ...info, note: { body: "Call Tuesday", updatedAt: "2026-11-05T15:00:00.000Z", updatedByName: null } }, false);
    expect(document.body.querySelector("textarea")).toBeNull();
    expect(document.body.textContent).toContain("Call Tuesday");
    expect(document.body.textContent).toContain("Last edited on Nov 5, 2026");
  });

  it("names the past project a return continues, with a link", async () => {
    await mount({ ...info, continues: { projectId: "old", name: "Research Computing Dashboard", lastTermCode: "26S" } });
    expect(document.body.textContent).toContain("Returning project");
    expect(document.body.textContent).toContain("Return of Research Computing Dashboard (last ran 26S)");
    const link = Array.from(document.body.querySelectorAll("a")).find((a) => a.textContent === "Research Computing Dashboard");
    expect(link?.getAttribute("href")).toBe("/projects/old");
  });

  it("says nothing about a return for a fresh application", async () => {
    await mount(info);
    expect(document.body.textContent).toContain("Application");
    expect(document.body.textContent).not.toContain("Return of");
  });
});
