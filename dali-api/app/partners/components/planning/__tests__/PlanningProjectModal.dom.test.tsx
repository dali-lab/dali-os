// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { PlanningProjectModal, sameSpots } from "../PlanningProjectModal";
import type { PlanningProjectInfo } from "~/partners/lib/planning-gap.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const info: PlanningProjectInfo = {
  description: "Old blurb",
  status: "Active",
  partnerNames: ["Acme"],
  plannedTerms: [{ id: "t26s", code: "26S", sortKey: 3 }],
  pisByTerm: { t26s: null },
  spotsByTerm: { t26s: [{ domainId: "eng", name: "Engineering", slots: 2 }] },
  note: { body: "Waiting on budget", updatedAt: "2026-11-05T15:00:00.000Z", updatedByName: "Ada Lovelace" },
  lastTerm: null,
};

const domains = [
  { id: "eng", name: "Engineering" },
  { id: "des", name: "Design" },
];

let container: HTMLDivElement;
let root: Root;
let posted: FormData[];

async function mount(canEdit = true, projectInfo: PlanningProjectInfo = info) {
  posted = [];
  const Page = () =>
    createElement(PlanningProjectModal, {
      project: { id: "p1", name: "Example", iconEmoji: null },
      info: projectInfo,
      coreMembers: [{ userId: "c1", name: "Core Person" }],
      domains,
      currentTermId: "t26s",
      canEdit,
      onClose: () => {},
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

const button = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  );
const click = (label: string) => act(async () => button(label)!.click());

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PlanningProjectModal spots", () => {
  it("shows a save button only after the spots change, and posts the new totals", async () => {
    await mount();
    expect(button("Save 26S spots")).toBeUndefined();
    await click("26S: More Engineering");
    await click("Save 26S spots");
    expect(posted).toHaveLength(1);
    expect(Object.fromEntries(posted[0])).toEqual({
      intent: "spots",
      projectId: "p1",
      termId: "t26s",
      roles: JSON.stringify([{ domainId: "eng", slots: 3 }]),
    });
  });

  it("drops the save button when the edit is undone with Cancel", async () => {
    await mount();
    await click("26S: Fewer Engineering");
    expect(button("Save 26S spots")).toBeDefined();
    await click("Cancel");
    expect(button("Save 26S spots")).toBeUndefined();
    expect(posted).toEqual([]);
  });
});

describe("PlanningProjectModal description", () => {
  it("posts the edited description", async () => {
    await mount();
    const textarea = document.body.querySelector<HTMLTextAreaElement>("textarea[aria-label='Project description']")!;
    expect(textarea.value).toBe("Old blurb");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "New blurb");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Save description");
    expect(Object.fromEntries(posted[0])).toEqual({ intent: "description", projectId: "p1", description: "New blurb" });
  });
});

async function typeInto(label: string, text: string) {
  const textarea = document.body.querySelector<HTMLTextAreaElement>(`textarea[aria-label='${label}']`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return textarea;
}

describe("PlanningProjectModal planning notes", () => {
  it("shows the note with who last edited it", async () => {
    await mount();
    const textarea = document.body.querySelector<HTMLTextAreaElement>("textarea[aria-label='Planning notes']")!;
    expect(textarea.value).toBe("Waiting on budget");
    expect(document.body.textContent).toContain("Last edited by Ada Lovelace on Nov 5, 2026");
    expect(document.body.textContent).toContain("Only shown here on Planning, not on the project page.");
  });

  it("posts the edited note for the project", async () => {
    await mount();
    await typeInto("Planning notes", "Budget approved");
    await click("Save notes");
    expect(Object.fromEntries(posted[0])).toEqual({
      intent: "note",
      ownerKind: "project",
      ownerId: "p1",
      body: "Budget approved",
    });
  });
});

describe("PlanningProjectModal read-only", () => {
  it("shows spots and the description without any editing controls", async () => {
    await mount(false);
    expect(document.body.textContent).toContain("Old blurb");
    expect(document.body.textContent).toContain("Engineering");
    expect(document.body.querySelector("textarea")).toBeNull();
    expect(document.body.textContent).toContain("Waiting on budget");
    expect(button("26S: More Engineering")).toBeUndefined();
  });
});

describe("sameSpots", () => {
  it("ignores order and zero-count rows", () => {
    expect(
      sameSpots(
        [
          { domainId: "a", name: "A", slots: 1 },
          { domainId: "b", name: "B", slots: 2 },
        ],
        [
          { domainId: "b", name: "B", slots: 2 },
          { domainId: "a", name: "A", slots: 1 },
          { domainId: "c", name: "C", slots: 0 },
        ],
      ),
    ).toBe(true);
    expect(sameSpots([{ domainId: "a", name: "A", slots: 1 }], [{ domainId: "a", name: "A", slots: 2 }])).toBe(false);
  });
});

describe("PlanningProjectModal for an undecided renewal", () => {
  const undecided: PlanningProjectInfo = {
    ...info,
    plannedTerms: [],
    pisByTerm: {},
    spotsByTerm: {},
    lastTerm: {
      id: "t26w",
      code: "26W",
      pi: { userId: "c1", name: "Core Person" },
      spots: [{ domainId: "eng", name: "Engineering", slots: 4 }],
    },
  };

  it("shows the last term with its PI and spots, read-only spots", async () => {
    await mount(true, undecided);
    expect(document.body.textContent).toContain("Last ran 26W");
    expect(document.body.textContent).toContain("Not decided yet");
    expect(document.body.textContent).toContain("4 spots");
    expect(document.body.querySelector("button[aria-label='PI for 26W']")).not.toBeNull();
    expect(document.body.querySelector("button[aria-label='26W: More Engineering']")).toBeNull();
  });

  it("assigns the PI on the last term so it carries forward", async () => {
    await mount(true, undecided);
    await act(async () => document.body.querySelector<HTMLButtonElement>("button[aria-label='PI for 26W']")!.click());
    await act(async () =>
      Array.from(document.body.querySelectorAll<HTMLButtonElement>("button[role='option']"))
        .find((o) => o.textContent === "No PI")!
        .click(),
    );
    expect(Object.fromEntries(posted[0])).toEqual({ intent: "pi", projectId: "p1", termId: "t26w", piUserId: "" });
  });
});
