// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub, useLocation } from "react-router";

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
import { ToastProvider } from "~/components/ui/toast";
import { PageBarSlotProvider, usePageBarTargetSetters } from "~/components/shell/page-bar-slot";
import { OverflowMenu } from "~/components/shell/OverflowMenu";
import { PageBarTrail } from "~/components/Breadcrumbs";

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

function Bar() {
  const { statusRef, actionsRef } = usePageBarTargetSetters();
  return createElement(
    "header",
    null,
    createElement(PageBarTrail, { crumbs: [{ label: "Forms", to: "/forms" }, { label: "My form", icon: createElement("span", { "data-testid": "glyph" }, "G") }] }),
    createElement("div", { "data-testid": "status", ref: statusRef }),
    createElement("div", { "data-testid": "actions", ref: actionsRef }),
    createElement(OverflowMenu, { shellItems: createElement("span", null, "shell") }),
  );
}

function SearchProbe() {
  return createElement("output", { "data-testid": "search" }, useLocation().search);
}

async function mount(data: ReturnType<typeof loaderData>, url = "/forms/edit/f1") {
  const Stub = createRoutesStub([
    {
      path: "/forms/edit/:formId",
      Component: () =>
        createElement(
          ToastProvider,
          null,
          createElement(
            DialogProvider,
            null,
            createElement(PageBarSlotProvider, { children: createElement("div", null, createElement(Bar), createElement(FormDetail), createElement(SearchProbe)) }),
          ),
        ),
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
      filterQuestions: [],
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
      filterQuestions: [],
      summary: {
        total: 4,
        questions: [{ kind: "text", key: "q1", number: 1, label: "Name", answered: 3, skipped: 1 }],
      },
    };
    const buttons = () => [...container.querySelectorAll("button")].map((b) => b.textContent);

    it("shows the summary under the three-way switch", async () => {
      await mount(loaderData({ results: null, summary } as never), url);
      expect(container.querySelector("table")).toBeNull();
      const radios = [...container.querySelectorAll("[role=radiogroup][aria-label='Form view'] [role=radio]")];
      expect(radios.map((r) => r.textContent?.replace(/\d+$/, ""))).toEqual(["Questions", "Summary", "Responses"]);
      expect(radios.filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.textContent)).toEqual(["Summary"]);
      expect(container.textContent).toContain("3 answered, 1 skipped");
    });

    it("shows the table under the toggle on the Responses view", async () => {
      await mount(loaderData({ results: table, summary: null } as never), `${url}&show=responses`);
      expect(container.querySelector("table")).not.toBeNull();
      const checked = container.querySelector("[role=radiogroup][aria-label='Form view'] [aria-checked=true]");
      expect(checked?.textContent).toMatch(/^Responses/);
    });

    const pick = async (label: string) => {
      const radio = [...container.querySelectorAll("[role=radiogroup][aria-label='Form view'] [role=radio]")].find((el) =>
        el.textContent?.startsWith(label),
      );
      await act(async () => void radio!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    };
    const search = () => new URLSearchParams(container.querySelector("[data-testid=search]")!.textContent!);

    it("switches Summary to Responses with show=responses, keeping the version", async () => {
      await mount(loaderData({ results: null, summary } as never), url);
      await pick("Responses");
      expect(search().get("show")).toBe("responses");
      expect(search().get("view")).toBe("results");
      expect(search().get("version")).toBe("1");
    });

    it("switches Responses to Summary dropping show and page", async () => {
      await mount(loaderData({ results: table, summary: null } as never), `${url}&show=responses&page=3&q=ada`);
      await pick("Summary");
      expect(search().get("show")).toBeNull();
      expect(search().get("page")).toBeNull();
      expect(search().get("version")).toBe("1");
      expect(search().get("q")).toBe("ada");
    });

    it("drops every results param when switching to Questions", async () => {
      await mount(loaderData({ results: table, summary: null } as never), `${url}&show=responses&a=q1:is:x`);
      await pick("Questions");
      expect(container.querySelector("[data-testid=search]")!.textContent).toBe("");
    });

    it("shows the version and who published it beside the switch", async () => {
      await mount(loaderData({ results: null, summary } as never), url);
      expect(container.textContent).toMatch(/v1 · published by .+, [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    });

    it("shows the search box on Responses only", async () => {
      await mount(loaderData({ results: table, summary: null } as never), `${url}&show=responses`);
      expect(container.querySelector("input[type=search], input[placeholder^='Search by name']")).not.toBeNull();
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
    const openOverflow = async () => {
      await click(document.body.querySelector("[aria-label='More actions']") ?? undefined);
    };
    const menuItem = (label: string) =>
      [...document.body.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent?.trim() === label);
    const withDraft = () => {
      const data = loaderData();
      data.form.draft = { questions: [question], description: null } as never;
      return data;
    };

    it("has no Save button in draft mode and offers Discard draft", async () => {
      await mount(withDraft());
      expect(button("Save")).toBeUndefined();
      expect(button("Cancel")).toBeUndefined();
      expect(button("Discard draft")).toBeUndefined();
      await openOverflow();
      expect(menuItem("Discard draft")).toBeTruthy();
    });

    it("hides Discard draft when no draft exists yet", async () => {
      const data = loaderData();
      data.form.versions = [];
      await mount(data);
      await openOverflow();
      expect(menuItem("Discard draft")).toBeUndefined();
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
      await openOverflow();
      await click(menuItem("Discard draft"));
      expect(submitted).toHaveLength(0);
      const confirm = [...document.body.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].find(
        (b) => b.textContent?.trim() === "Discard draft",
      );
      await click(confirm);
      await wait(50);
      expect(submitted).toEqual([{ intent: "discard-draft", id: "f1" }]);
      await until(() => text().includes("Responses"));
      expect(text()).toContain("Responses");
    });

    it("does not discard when the confirm is cancelled", async () => {
      await mount(withDraft());
      await openOverflow();
      await click(menuItem("Discard draft"));
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
      await openOverflow();
      expect(menuItem("Discard draft")).toBeUndefined();
      expect(text()).toContain("Editing v2 draft");
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

  describe("page bar", () => {
    const click = async (el: Element | null | undefined) => {
      expect(el).toBeTruthy();
      await act(async () => {
        el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    const actions = () => container.querySelector("[data-testid=actions]")!;
    const actionLabels = () => [...actions().querySelectorAll("button")].map((b) => b.textContent?.trim());
    const status = () => container.querySelector("[data-testid=status]")!.textContent;
    const overflow = async () => {
      await click(container.querySelector("[aria-label='More actions']"));
      return [...document.body.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent?.trim());
    };
    const published = () => {
      const data = loaderData();
      Object.assign(data.form, { published: true, publicToken: "tok" });
      return data;
    };

    it("has no title row in the page", async () => {
      await mount(loaderData());
      expect(container.querySelector("input[aria-label='Form name']")).toBeNull();
    });

    it("shows a published version in the status slot", async () => {
      await mount(published());
      expect(status()).toContain("v1 · Published");
    });

    it("shows an unpublished version as not published", async () => {
      await mount(loaderData());
      expect(status()).toContain("v1 · Not published");
    });

    it("shows the editing status with the autosave state", async () => {
      const data = loaderData();
      data.form.draft = { questions: [question], description: null } as never;
      await mount(data);
      expect(status()).toContain("Editing v2 draft");
    });

    it("viewing a published version: Preview, Copy link, Share, then a filled New version", async () => {
      await mount(published());
      expect(actionLabels()).toEqual(["Preview", "Copy form link", "Share", "New version"]);
      expect(actions().querySelector("button:last-child")!.className).toContain("bg-accent-coral");
    });

    it("drafting: the primary is Publish, not New version", async () => {
      const data = published();
      data.form.draft = { questions: [question], description: null } as never;
      await mount(data);
      expect(actionLabels()).toEqual(["Preview", "Copy form link", "Share", "Publish"]);
    });

    it("viewing an unpublished version: the primary is Publish", async () => {
      await mount(loaderData());
      expect(actionLabels()).toEqual(["Preview", "Copy form link", "Share", "Publish"]);
    });

    it("disables Copy form link until the form is published", async () => {
      await mount(loaderData());
      const copy = [...actions().querySelectorAll("button")].find((b) => b.textContent?.trim() === "Copy form link")!;
      expect(copy.hasAttribute("disabled")).toBe(true);
    });

    it("copies the fill link when published", async () => {
      const writeText = vi.fn(async () => {});
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      await mount(published());
      const copy = [...actions().querySelectorAll("button")].find((b) => b.textContent?.trim() === "Copy form link")!;
      await click(copy);
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/forms/fill/tok`);
    });

    it("moves settings, QR code and Unpublish into the overflow", async () => {
      await mount(published());
      expect(await overflow()).toEqual(["Form settings", "QR code", "Unpublish"]);
    });

    it("offers no QR code or Unpublish before publishing", async () => {
      await mount(loaderData());
      expect(await overflow()).toEqual(["Form settings"]);
    });

    it("adds Discard draft to the overflow when a draft exists", async () => {
      const data = loaderData();
      data.form.draft = { questions: [question], description: null } as never;
      await mount(data);
      expect(await overflow()).toContain("Discard draft");
    });

    it("renames from the title crumb with the existing rename action", async () => {
      await mount(loaderData());
      await click(container.querySelector("button[aria-label='Rename']"));
      const input = container.querySelector<HTMLInputElement>("input[aria-label='Page name']")!;
      expect(input.value).toBe("My form");
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Renamed form");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
      expect(submitted).toContainEqual({ intent: "rename-form", id: "f1", name: "Renamed form" });
    });

    it("keeps the crumb glyph static, with no icon picker in the bar", async () => {
      await mount(loaderData());
      expect(container.querySelector("[data-testid=glyph]")!.closest("button")).toBeNull();
    });

    it("renames from the page title with the existing rename action", async () => {
      await mount(loaderData());
      const input = container.querySelector<HTMLInputElement>("input[aria-label='Title']")!;
      expect(input.value).toBe("My form");
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Renamed form");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => void input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
      await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
      expect(submitted).toContainEqual({ intent: "rename-form", id: "f1", name: "Renamed form" });
    });

    it("sets the form icon from the page title with set-form-icon", async () => {
      await mount(loaderData());
      await click([...container.querySelectorAll("button")].find((b) => b.textContent === "Add icon"));
      await click([...document.body.querySelectorAll("button")].find((b) => b.textContent === "🚀"));
      await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
      expect(submitted).toContainEqual({ intent: "set-form-icon", id: "f1", iconEmoji: "🚀" });
    });

    it("has no Rename row in the overflow", async () => {
      await mount(loaderData());
      expect(await overflow()).not.toContain("Rename");
    });

    it("hides Copy form link and Share for a managed form and offers Publish only while drafting", async () => {
      const data = loaderData({ managing: { label: "Fall hiring" } });
      await mount(data);
      expect(actionLabels()).toEqual(["Preview"]);
      expect(actions().textContent).toContain("Managed by Fall hiring");
      expect(actions().textContent).not.toContain("Share");
    });

    it("shows Publish for a managed form while drafting", async () => {
      const data = loaderData({ managing: { label: "Fall hiring" } });
      data.form.draft = { questions: [question], description: null } as never;
      await mount(data);
      expect(actionLabels()).toEqual(["Preview", "Publish"]);
    });

    it("leaves the results view with the answer filters cleared", async () => {
      await mount(loaderData(), "/forms/edit/f1?view=results&version=1&show=responses&q=ada&a=k:is:A");
      const questions = [...container.querySelectorAll("[role=radiogroup][aria-label='Form view'] [role=radio]")].find(
        (el) => el.textContent === "Questions",
      );
      await act(async () => void questions!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(container.querySelector("[data-testid=search]")!.textContent).toBe("");
    });

    it("uses one Segmented control for Questions, Summary and Responses", async () => {
      await mount(loaderData());
      const group = container.querySelector("[role=radiogroup][aria-label='Form view']")!;
      expect(group.textContent).toContain("Questions");
      expect(group.textContent).toContain("Summary");
      expect(group.textContent).toContain("Responses");
    });
  });
});
