// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { PlanningApplicationPanel } from "../PlanningApplicationPanel";
import type { PlanningApplicationInfo } from "~/partners/lib/planning-gap.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let posted: FormData[];

async function mount(info: PlanningApplicationInfo, canEdit = true) {
  posted = [];
  const Page = () =>
    createElement(PlanningApplicationPanel, {
      applicationId: "a1",
      info,
      canEdit,
      coreMembers: [{ userId: "c1", name: "Core Person" }],
      domains: [
        { id: "eng", name: "Engineering" },
        { id: "des", name: "Design" },
      ],
    });
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
  summary: "A kiosk for the museum lobby",
  pi: null,
  targetTermCodes: ["27W", "27S"],
  spots: [{ domainId: "eng", name: "Engineering", slots: 2 }],
};

const click = (el: Element) => act(async () => (el as HTMLElement).click());
const buttonByText = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === text);

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PlanningApplicationPanel", () => {
  it("leaves the summary and PI to the application window, showing the PI read-only", async () => {
    await mount({ ...info, pi: { userId: "c1", name: "Core Person" } });
    expect(document.body.querySelector("textarea[aria-label='Application summary']")).toBeNull();
    expect(document.body.querySelector("button[aria-label='PI for Application']")).toBeNull();
    expect(document.body.textContent).toContain("Core Person");
    expect(document.body.textContent).toContain("Set the PI in the panel on the right.");
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
    expect(document.body.textContent).toContain("Return of Research Computing Dashboard (last ran 26S)");
    const link = Array.from(document.body.querySelectorAll("a")).find((a) => a.textContent === "Research Computing Dashboard");
    expect(link?.getAttribute("href")).toBe("/projects/old");
  });

  it("says nothing about a return for a fresh application", async () => {
    await mount(info);
    expect(document.body.textContent).not.toContain("Return of");
  });

  it("shows the target terms and expected spots like a confirmed project", async () => {
    await mount(info);
    expect(document.body.textContent).toContain("Wants 27W, 27S");
    expect(document.body.textContent).toContain("2 spots");
  });

  it("posts edited expected spots", async () => {
    await mount(info);
    await click(document.body.querySelector("button[aria-label='Application: More Engineering']")!);
    await click(buttonByText("Save spots")!);
    expect(Object.fromEntries(posted[0])).toEqual({
      intent: "application-spots",
      applicationId: "a1",
      roles: JSON.stringify([{ domainId: "eng", slots: 3 }]),
    });
  });

});
