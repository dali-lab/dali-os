// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";

// The rich-text editor and the collab room need a real browser + server.
vi.mock("~/components/doc", () => ({ DocEditor: () => null }));
vi.mock("~/components/collab/useSharedCollection", async () => {
  const { useState } = await import("react");
  return {
    useSharedArray: (_room: string, _token: string | null, _key: string, initial: unknown[]) => {
      const [items, setItems] = useState(initial);
      return {
        items,
        setItems,
        push: (item: unknown) => setItems((p) => [...p, item]),
        remove: (i: number) => setItems((p) => p.filter((_, j) => j !== i)),
        move: () => {},
        undo: () => {},
        redo: () => {},
        canUndo: false,
        canRedo: false,
        synced: true,
      };
    },
  };
});
vi.mock("~/hooks/useUserTimeZone", () => ({ useUserTimeZone: () => "America/New_York" }));

import { FormDetail } from "../FormDetail";
import { DialogProvider } from "~/components/ui/dialog";
import { FeatureFlagsProvider } from "~/components/FeatureFlags";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const question = {
  key: "q1",
  type: "text",
  required: true,
  data: { label: "Name" },
};

function loaderData(overrides: Record<string, unknown> = {}) {
  return {
    form: {
      id: "f1",
      name: "My form",
      createdAt: new Date().toISOString(),
      published: false,
      publicToken: null,
      oneResponsePerMember: false,
      notifyOnSubmission: false,
      listed: false,
      opensAt: null,
      closesAt: null,
      folderPageId: null,
      draft: null,
      versions: [
        {
          id: "v1",
          versionNumber: 1,
          questions: [question],
          description: null,
          createdAt: new Date().toISOString(),
          createdByName: "Ada",
          submissionCount: 0,
          locked: false,
        },
      ],
    },
    terms: [],
    usages: [],
    managing: null,
    hiringLinks: [],
    driveCrumbs: null,
    page: { workspaceType: "Lab" },
    collabToken: null,
    results: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

async function mount(data: ReturnType<typeof loaderData>, url = "/forms/edit/f1", flagOn = false) {
  const Stub = createRoutesStub([
    {
      path: "/forms/edit/:formId",
      Component: () =>
        createElement(
          FeatureFlagsProvider,
          { flags: { "form-upgrades": flagOn } },
          createElement(DialogProvider, null, createElement(FormDetail)),
        ),
      loader: () => data,
    },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: [url] }));
  });
  // Let the stub's loader resolve and the route render.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("FormDetail", () => {
  it("renders a version view", async () => {
    await mount(loaderData());
    expect(container.textContent).toContain("Questions");
    expect(container.textContent).toContain("Name");
  });

  it("renders the builder for a form with a draft", async () => {
    const data = loaderData();
    data.form.draft = { questions: [question], description: null } as never;
    await mount(data);
    expect(container.textContent).toContain("Short answer");
  });

  // Regression: a question saved without a key crashed the builder on render
  // ("Cannot read properties of null (reading 'after')").
  it("renders the builder when a question has no key", async () => {
    const data = loaderData();
    const { key: _key, ...keyless } = question;
    data.form.draft = { questions: [keyless], description: null } as never;
    await mount(data);
    expect(container.textContent).toContain("Name");
    expect(container.textContent).not.toContain("Unexpected Application Error");
  });

  // Regression: an earlier collab bug stored empty `{}` questions in drafts,
  // which crashed the builder ("reading 'label'").
  it("renders the builder when the draft holds an empty question", async () => {
    const data = loaderData();
    data.form.draft = { questions: [{}, question], description: null } as never;
    await mount(data);
    expect(container.textContent).toContain("Name");
    expect(container.textContent).not.toContain("Unexpected Application Error");
  });

  it("offers Add icon on a form without one", async () => {
    await mount(loaderData());
    expect(container.textContent).toContain("Add icon");
  });

  it("shows the form's icon before its name", async () => {
    const data = loaderData();
    (data.form as Record<string, unknown>).iconEmoji = "📋";
    await mount(data);
    expect(container.textContent).toContain("📋");
    expect(container.textContent).not.toContain("Add icon");
  });

  it("renders the builder for a brand-new form", async () => {
    const data = loaderData();
    data.form.versions = [];
    await mount(data);
    expect(container.textContent).toContain("Drag a component here");
  });

  describe("results view", () => {
    const url = "/forms/edit/f1?view=results&version=1";
    const table = {
      versionId: "v1",
      isPartnerApplicationForm: false,
      totalCount: 1,
      matchCount: 1,
      page: 1,
      hasNext: false,
      columns: [{ key: "q1", label: "Name" }],
      slotOptions: [],
      responses: [
        {
          id: "s1",
          createdAt: "2026-05-20T10:00:00.000Z",
          edited: false,
          lockReason: null,
          name: "Ada",
          email: null,
          slot: null,
          submitterIp: null,
          partnerApplication: null,
          rows: [{ key: "q1", label: "Name", value: "Ada" }],
        },
      ],
    };
    const summary = {
      versionId: "v1",
      slotOptions: [],
      summary: {
        total: 4,
        questions: [{ kind: "text", key: "q1", number: 1, label: "Name", answered: 3, skipped: 1 }],
      },
    };
    const buttons = () => [...container.querySelectorAll("button")].map((b) => b.textContent);

    it("shows only the table while the flag is off", async () => {
      await mount(loaderData({ results: table, summary: null } as never), url, false);
      expect(container.querySelector("table")).not.toBeNull();
      expect(buttons()).not.toContain("Summary");
      expect(buttons()).not.toContain("Responses");
    });

    it("shows the summary with the Summary | Responses toggle when the flag is on", async () => {
      await mount(loaderData({ results: null, summary } as never), url, true);
      expect(container.querySelector("table")).toBeNull();
      expect(buttons()).toEqual(expect.arrayContaining(["Summary", "Responses"]));
      expect(container.textContent).toContain("3 answered, 1 skipped");
    });

    it("shows the table under the toggle on the Responses view", async () => {
      await mount(loaderData({ results: table, summary: null } as never), `${url}&show=responses`, true);
      expect(container.querySelector("table")).not.toBeNull();
      expect(buttons()).toContain("Summary");
    });
  });
});
