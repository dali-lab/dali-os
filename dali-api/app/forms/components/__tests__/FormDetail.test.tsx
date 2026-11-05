// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";

const history = vi.hoisted(() => ({ undo: vi.fn(), redo: vi.fn() }));

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
        undo: history.undo,
        redo: history.redo,
        canUndo: true,
        canRedo: true,
        synced: true,
      };
    },
  };
});
vi.mock("~/hooks/useUserTimeZone", () => ({ useUserTimeZone: () => "America/New_York" }));

import { FormDetail } from "../FormDetail";
import { DialogProvider } from "~/components/ui/dialog";

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

const submitted: Array<Record<string, string>> = [];
let actionResult: Record<string, unknown> = { ok: true };

async function mount(data: ReturnType<typeof loaderData>, url = "/forms/edit/f1") {
  const Stub = createRoutesStub([
    {
      path: "/forms/edit/:formId",
      Component: () =>
        createElement(DialogProvider, null, createElement(FormDetail)),
      loader: () => data,
      action: async ({ request }) => {
        submitted.push(Object.fromEntries(await request.formData()) as Record<string, string>);
        return { ...actionResult };
      },
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
  submitted.length = 0;
  actionResult = { ok: true };
  act(() => root.unmount());
  container.remove();
});

describe("FormDetail", () => {
  it("renders a version view", async () => {
    await mount(loaderData());
    expect(container.textContent).toContain("Questions");
    expect(container.textContent).toContain("Name");
  });

  it("undoes and redoes the builder's edits from the keyboard", async () => {
    const data = loaderData({ collabToken: "token" });
    data.form.draft = { questions: [question], description: null } as never;
    await mount(data);
    history.undo.mockClear();
    history.redo.mockClear();
    act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true })));
    expect(history.undo).toHaveBeenCalledTimes(1);
    act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true, bubbles: true })));
    expect(history.redo).toHaveBeenCalledTimes(1);
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

    it("shows the summary with the Summary | Responses toggle", async () => {
      await mount(loaderData({ results: null, summary } as never), url);
      expect(container.querySelector("table")).toBeNull();
      expect(buttons()).toEqual(expect.arrayContaining(["Summary", "Responses"]));
      expect(container.textContent).toContain("3 answered, 1 skipped");
    });

    it("shows the table under the toggle on the Responses view", async () => {
      await mount(loaderData({ results: table, summary: null } as never), `${url}&show=responses`);
      expect(container.querySelector("table")).not.toBeNull();
      expect(buttons()).toContain("Summary");
    });
  });

  describe("draft autosave", () => {
    const text = () => container.textContent ?? "";
    const button = (label: string) =>
      [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
    const click = async (el: Element | undefined) => {
      expect(el).toBeTruthy();
      await act(async () => {
        el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 40 && !check(); i++) await wait(50);
    };
    const addQuestion = async () => {
      await click(button("Add a question"));
      const item = [...document.body.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent?.includes("Short answer"));
      await click(item);
    };
    const withDraft = () => {
      const data = loaderData();
      data.form.draft = { questions: [question], description: null } as never;
      return data;
    };

    it("has no Save button in draft mode and offers Discard draft", async () => {
      await mount(withDraft());
      expect(button("Save")).toBeUndefined();
      expect(button("Cancel")).toBeUndefined();
      expect(button("Discard draft")).toBeTruthy();
    });

    it("hides Discard draft when no draft exists yet", async () => {
      const data = loaderData();
      data.form.versions = [];
      await mount(data);
      expect(button("Discard draft")).toBeUndefined();
    });

    it("saves the draft once after edits stop and shows Saved", async () => {
      await mount(withDraft());
      await addQuestion();
      expect(submitted).toHaveLength(0);
      await wait(1200);
      expect(submitted.filter((s) => s.intent === "save-draft")).toHaveLength(1);
      expect(JSON.parse(submitted[0].questions)).toHaveLength(2);
      await until(() => text().includes("Saved"));
      expect(text()).toContain("Saved");
    });

    it("does not save when nothing changed", async () => {
      await mount(withDraft());
      await wait(1200);
      expect(submitted).toHaveLength(0);
    });

    it("shows Couldn't save with Retry on failure and resends on Retry", async () => {
      actionResult = { error: "Nope" };
      await mount(withDraft());
      await addQuestion();
      await wait(1200);
      await until(() => text().includes("Couldn't save"));
      expect(text()).toContain("Couldn't save · Retry");
      actionResult = { ok: true };
      await click(button("Couldn't save · Retry"));
      await until(() => text().includes("Saved"));
      expect(submitted.filter((s) => s.intent === "save-draft")).toHaveLength(2);
      expect(text()).toContain("Saved");
    });

    it("confirms before discarding a draft, then submits discard-draft", async () => {
      await mount(withDraft());
      await click(button("Discard draft"));
      expect(submitted).toHaveLength(0);
      const confirm = [...document.body.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].find(
        (b) => b.textContent?.trim() === "Discard draft",
      );
      await click(confirm);
      await wait(50);
      expect(submitted).toEqual([{ intent: "discard-draft", id: "f1" }]);
      await until(() => button("Discard draft") === undefined);
      expect(button("Discard draft")).toBeUndefined();
      expect(text()).toContain("Results");
    });

    it("does not discard when the confirm is cancelled", async () => {
      await mount(withDraft());
      await click(button("Discard draft"));
      const cancel = [...document.body.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].find(
        (b) => b.textContent?.trim() === "Cancel",
      );
      await click(cancel);
      await wait(50);
      expect(submitted).toHaveLength(0);
    });

    it("routes an edit of a published version into the draft", async () => {
      await mount(loaderData());
      await click(button("Versions") ?? [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes("v1")));
      await click(button("Edit v1"));
      expect(button("Discard draft")).toBeUndefined();
      expect(text()).toContain("Draft");
      await addQuestion();
      await wait(1200);
      expect(submitted.map((s) => s.intent)).toEqual(["save-draft"]);
    });

    it("flushes a pending autosave before publishing", async () => {
      await mount(withDraft());
      await addQuestion();
      await click(button("Publish"));
      await wait(100);
      expect(submitted.map((s) => s.intent)).toEqual(["save-draft", "save-version"]);
      expect(submitted[1].publish).toBe("true");
    });
  });
});
