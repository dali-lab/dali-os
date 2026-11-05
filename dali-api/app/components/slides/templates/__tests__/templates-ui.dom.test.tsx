// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const dialog = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => dialog }));

import { NewSlideSplit } from "~/components/slides/collab/NewSlideSplit";
import { NewDeckFromTemplate } from "../NewDeckFromTemplate";
import { SaveTemplateModal } from "../SaveTemplateModal";
import { TemplateLibrary, templateMeta } from "../TemplateLibrary";
import { applyTemplateToDeck, fetchScopeTemplates, fetchTemplates, removeTemplate, saveTemplate, type TemplateRow } from "../templates-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  dialog.confirm.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const render = (node: React.ReactElement) => act(() => root.render(node));
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })));
const byText = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLElement;
const setValue = (input: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

const row = (over: Partial<TemplateRow> = {}): TemplateRow => ({ id: "t1", kind: "Slide", title: "Agenda", themeId: "dali-dark", slideCount: 1, scope: "lab", firstLayoutId: "content", canDelete: true, ...over });

describe("TemplateLibrary", () => {
  it("lists saved slides with their size and scope, and picks one", () => {
    const onPick = vi.fn();
    render(createElement(TemplateLibrary, { templates: [row(), row({ id: "t2", title: "Pitch", kind: "Deck", slideCount: 8, scope: "project" })], loaded: true, onPick }));
    expect(container.textContent).toContain("1 slide · Lab");
    expect(container.textContent).toContain("8 slides · Project · DALI Dark");
    click(byText("Agenda1 slide · Lab", container));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("filters by kind and explains an empty library", () => {
    render(createElement(TemplateLibrary, { templates: [row()], loaded: true, kind: "Deck", onPick: vi.fn() }));
    expect(container.textContent).toContain("No saved decks yet");
    render(createElement(TemplateLibrary, { templates: [], loaded: true, onPick: vi.fn() }));
    expect(container.textContent).toContain("Right-click a slide and choose Save to library");
    render(createElement(TemplateLibrary, { templates: [], loaded: false, onPick: vi.fn() }));
    expect(container.textContent).toContain("Loading");
  });

  it("deletes only after confirming, and only when the viewer may", async () => {
    const onDelete = vi.fn();
    render(createElement(TemplateLibrary, { templates: [row(), row({ id: "t2", title: "Theirs", canDelete: false })], loaded: true, onPick: vi.fn(), onDelete }));
    expect(container.querySelector("[aria-label='Delete Theirs']")).toBeNull();
    dialog.confirm.mockResolvedValueOnce(false);
    await act(async () => click(container.querySelector("[aria-label='Delete Agenda']")));
    expect(onDelete).not.toHaveBeenCalled();
    dialog.confirm.mockResolvedValueOnce(true);
    await act(async () => click(container.querySelector("[aria-label='Delete Agenda']")));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("describes a deck with its theme", () => {
    expect(templateMeta(row({ kind: "Deck", slideCount: 3 }))).toBe("3 slides · Lab · DALI Dark");
  });
});

describe("New slide gallery", () => {
  const library = (onPick = vi.fn()) => ({ templates: [row()], loaded: true, onPick, onDelete: vi.fn() });
  const open = (props: Record<string, unknown>) => {
    render(createElement(NewSlideSplit, { themeId: "dali-dark", layoutId: "content", onAdd: vi.fn(), ...props }));
    click(container.querySelector("[aria-label='Choose a layout']"));
  };

  it("shows only layouts when the deck has no library", () => {
    open({});
    expect(document.querySelector("[role=radiogroup]")).toBeNull();
    expect(document.querySelector("[aria-label=Layouts]")).not.toBeNull();
  });

  it("switches to the library tab and inserts the one picked", () => {
    const onPick = vi.fn();
    open({ library: library(onPick) });
    click(byText("Library"));
    click(byText("Agenda1 slide · Lab"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });
});

describe("SaveTemplateModal", () => {
  const props = (over: Record<string, unknown> = {}) => ({ open: true, kind: "Deck" as const, slideCount: 4, defaultTitle: "Kickoff", canSaveToProject: false, onSave: vi.fn(async () => null), onClose: vi.fn(), ...over });
  const field = () => document.querySelector("input[type=text]") as HTMLInputElement;
  const submit = () => act(async () => void document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

  it("saves under the typed name for the lab", async () => {
    const p = props();
    render(createElement(SaveTemplateModal, p));
    expect(document.body.textContent).toContain("Save as template");
    setValue(field(), "Team kickoff");
    await submit();
    expect(p.onSave).toHaveBeenCalledWith("Team kickoff", "lab");
  });

  it("offers the project only when the deck is in one", async () => {
    const p = props({ canSaveToProject: true, kind: "Slide", slideCount: 1 });
    render(createElement(SaveTemplateModal, p));
    expect(document.body.textContent).toContain("Save to library");
    click(document.querySelector("input[value=project]") ?? byText("This project"));
    await submit();
    expect(p.onSave).toHaveBeenCalledWith("Kickoff", "project");
    render(createElement(SaveTemplateModal, props()));
    expect(document.querySelector("[aria-label='Who can use it']")).toBeNull();
  });

  it("does not save a blank name and shows the server's error", async () => {
    const p = props({ onSave: vi.fn(async () => "That's too large to save as a template.") });
    render(createElement(SaveTemplateModal, p));
    setValue(field(), "   ");
    await submit();
    expect(p.onSave).not.toHaveBeenCalled();
    setValue(field(), "Big");
    await submit();
    expect(document.querySelector("[role=alert]")!.textContent).toContain("too large");
  });
});

describe("NewDeckFromTemplate", () => {
  it("loads the scope's templates, shows decks only, and picks one", async () => {
    const fetchMock = vi.fn(async () => Response.json({ templates: [row({ id: "d1", kind: "Deck", title: "Pitch", slideCount: 5 }), row()] }));
    vi.stubGlobal("fetch", fetchMock);
    const onPick = vi.fn();
    await act(async () => render(createElement(NewDeckFromTemplate, { open: true, projectId: "proj1", onPick, onClose: vi.fn() })));
    expect(fetchMock).toHaveBeenCalledWith("/api/slide-templates?projectId=proj1", expect.anything());
    expect(document.body.textContent).toContain("Pitch");
    expect(document.body.textContent).not.toContain("Agenda");
    click(byText("Pitch5 slides · Lab · DALI Dark"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
  });
});

describe("templates client", () => {
  it("sends and reads the template calls", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(_url).includes("from-template")) return Response.json({ slideIds: [] });
      if (init?.method === "POST") return Response.json({ id: "n" }, { status: 201 });
      if (init?.method === "DELETE") return Response.json({ ok: true });
      return Response.json({ templates: [], canSaveToProject: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchTemplates("p1")).toEqual({ templates: [], canSaveToProject: true });
    expect(await saveTemplate({ kind: "Slide", title: "x", pageId: "p1", scope: "lab", themeId: "dali-dark", slides: [] })).toEqual({ ok: true });
    expect(await removeTemplate("t1")).toBe(true);
    expect(await applyTemplateToDeck("p1", "t1")).toEqual({ ok: true });
    expect(await fetchScopeTemplates(null)).toEqual([]);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/slide-templates?pageId=p1", "/api/slide-templates", "/api/slide-templates/t1", "/api/slides/p1/from-template", "/api/slide-templates"]);
  });

  it("returns the server's message on a refused save and a quiet failure when offline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "This deck isn't in a project." }, { status: 400 })));
    expect(await saveTemplate({ kind: "Deck", title: "x", pageId: "p1", scope: "project", themeId: "dali-dark", slides: [] })).toEqual({ ok: false, error: "This deck isn't in a project." });
    expect(await removeTemplate("t1")).toBe(false);
    expect(await fetchTemplates("p1")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await applyTemplateToDeck("p1", "t1")).toMatchObject({ ok: false });
    expect(await fetchTemplates("p1")).toBeNull();
  });
});
