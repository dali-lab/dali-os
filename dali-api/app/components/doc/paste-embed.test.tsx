// @vitest-environment jsdom
import { BlockNoteEditor } from "@blocknote/core";
import { en } from "@blocknote/core/locales";
import { locales as multiColumnLocales } from "@blocknote/xl-multi-column";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITOR_PRESETS, type EditorPresetName } from "./features";
import { applyPasteEmbed, docPasteHandler, offerIsCurrent, PASTE_OFFER_EVENT, type PasteOffer } from "./paste-embed";
import { PasteAsMenu } from "./PasteAsMenu";
import { buildSchema, type DocEditorInstance } from "./schema/build";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const URL_ = "https://youtu.be/OY8fr2E96lg";
const text = (value: string) => ({ type: "text", text: value, styles: {} });

function editorWith(content: unknown[], preset: EditorPresetName = "resource") {
  const editor = BlockNoteEditor.create({
    schema: buildSchema(EDITOR_PRESETS[preset]),
    dictionary: { ...en, multi_column: multiColumnLocales.en },
    initialContent: content,
  } as never) as unknown as DocEditorInstance;
  const root = document.createElement("div");
  document.body.append(root);
  editor.mount(root);
  editor.prosemirrorView.coordsAtPos = () => ({ left: 10, right: 10, top: 10, bottom: 30 });
  return editor;
}

function paste(editor: DocEditorInstance, data: Record<string, string>) {
  const defaultPasteHandler = vi.fn(() => true);
  const event = {
    clipboardData: { types: Object.keys(data), getData: (type: string) => data[type] ?? "" },
  } as unknown as ClipboardEvent;
  const offers: PasteOffer[] = [];
  const listen = (e: Event) => offers.push((e as CustomEvent<PasteOffer>).detail);
  editor.domElement!.addEventListener(PASTE_OFFER_EVENT, listen);
  act(() => {
    docPasteHandler({ event, editor, defaultPasteHandler });
  });
  editor.domElement!.removeEventListener(PASTE_OFFER_EVENT, listen);
  return { defaultPasteHandler, offers };
}

const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });

function pasteAtEnd(editor: DocEditorInstance, data: Record<string, string> = { "text/plain": URL_ }) {
  editor.setTextCursorPosition(editor.document[0]!, "end");
  return paste(editor, data);
}

const types = (editor: DocEditorInstance) => editor.document.map((block) => block.type);

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("docPasteHandler", () => {
  it("pastes a YouTube URL as a link and offers it", () => {
    const editor = editorWith([paragraph()]);
    const { offers, defaultPasteHandler } = pasteAtEnd(editor);
    expect(offers).toEqual([{ blockId: editor.document[0]!.id, url: URL_ }]);
    expect(defaultPasteHandler).not.toHaveBeenCalled();
    expect(editor.document[0]!.content).toMatchObject([{ type: "link", href: URL_ }]);
  });

  it.each([
    ["another URL", { "text/plain": "https://example.com/page" }],
    ["a URL with other text", { "text/plain": `Watch ${URL_}` }],
    ["several URLs", { "text/plain": `${URL_}\n${URL_}` }],
    ["a file", { Files: "", "text/plain": URL_ }],
    ["blocks copied from a doc", { "blocknote/html": "<p>x</p>", "text/plain": URL_ }],
  ])("leaves %s to the default paste", (_label, data) => {
    const { offers, defaultPasteHandler } = pasteAtEnd(editorWith([paragraph()]), data);
    expect(offers).toEqual([]);
    expect(defaultPasteHandler).toHaveBeenCalledOnce();
  });

  it("leaves a paste over a selection to the default paste", () => {
    const editor = editorWith([paragraph(text("Pick")), paragraph(text("me"))]);
    editor.setSelection(editor.document[0]!, editor.document[1]!);
    const { offers, defaultPasteHandler } = paste(editor, { "text/plain": URL_ });
    expect(offers).toEqual([]);
    expect(defaultPasteHandler).toHaveBeenCalledOnce();
  });

  it("leaves a heading to the default paste", () => {
    const editor = editorWith([{ type: "heading", props: { level: 1 }, content: [] }]);
    expect(pasteAtEnd(editor).offers).toEqual([]);
  });

  it("makes no offer on a surface without video blocks", () => {
    expect(pasteAtEnd(editorWith([paragraph()], "notes")).offers).toEqual([]);
  });
});

describe("applyPasteEmbed", () => {
  const offerIn = (editor: DocEditorInstance, index = 0) => ({ blockId: editor.document[index]!.id, url: URL_ });
  const link = { type: "link", href: URL_, content: [text(URL_)] };

  it("replaces a link alone on its line and moves to a new line", () => {
    const editor = editorWith([paragraph(link)]);
    applyPasteEmbed(editor, offerIn(editor), "video");
    expect(types(editor)).toEqual(["video", "paragraph"]);
    expect(editor.document[0]!.props).toMatchObject({ url: URL_ });
    expect(editor.getTextCursorPosition().block.id).toBe(editor.document[1]!.id);
  });

  it("reuses a blank line that already follows", () => {
    const editor = editorWith([paragraph(link), paragraph()]);
    applyPasteEmbed(editor, offerIn(editor), "video");
    expect(types(editor)).toEqual(["video", "paragraph"]);
  });

  it("keeps a sentence whole and puts the player below it", () => {
    const editor = editorWith([paragraph(text("Watch "), link, text(" before Friday."))]);
    applyPasteEmbed(editor, offerIn(editor), "video");
    expect(types(editor)).toEqual(["paragraph", "video", "paragraph"]);
    expect(editor.document[0]!.content).toHaveLength(3);
  });

  it("makes a bookmark", () => {
    const editor = editorWith([paragraph(link)]);
    applyPasteEmbed(editor, offerIn(editor), "embed");
    expect(editor.document[0]).toMatchObject({ type: "embed", props: { url: URL_ } });
  });

  it("changes nothing once the link has been edited away", () => {
    const editor = editorWith([paragraph(link)]);
    const offer = offerIn(editor);
    editor.updateBlock(editor.document[0]!, { content: [text("Gone")] } as never);
    expect(offerIsCurrent(editor, offer)).toBe(false);
    applyPasteEmbed(editor, offer, "video");
    expect(types(editor)).toEqual(["paragraph"]);
  });

  it("changes nothing once the block has been deleted", () => {
    const editor = editorWith([paragraph(link), paragraph(text("Keep"))]);
    const offer = offerIn(editor);
    editor.removeBlocks([editor.document[0]!]);
    applyPasteEmbed(editor, offer, "video");
    expect(types(editor)).toEqual(["paragraph"]);
  });
});

describe("PasteAsMenu", () => {
  async function opened(preset: EditorPresetName = "resource") {
    const editor = editorWith([paragraph()], preset);
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<PasteAsMenu editor={editor} />));
    pasteAtEnd(editor);
    await act(async () => {});
    return editor;
  }

  function key(name: string): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key: name, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    return event;
  }
  const menu = () => document.querySelector("[role='menu']");
  const rowEls = () => [...document.querySelectorAll<HTMLElement>("[role='menuitem']")];
  const rows = () => rowEls().map((row) => row.textContent);
  const row = (label: string) => rowEls().find((el) => el.textContent === label)!;

  it("offers the three options, with the label", async () => {
    await opened();
    expect(menu()!.textContent).toContain("Paste as");
    expect(rows()).toEqual(["Embed video", "Bookmark", "URL"]);
  });

  it("drops Bookmark on a surface without bookmarks", async () => {
    await opened("guide");
    expect(rows()).toEqual(["Embed video", "URL"]);
  });

  it("Enter takes Embed video", async () => {
    const editor = await opened();
    key("Enter");
    expect(types(editor)[0]).toBe("video");
    expect(menu()).toBeNull();
  });

  it("arrow keys move the highlight, wrapping at the ends", async () => {
    const editor = await opened();
    key("ArrowUp");
    key("ArrowUp");
    key("Enter");
    expect(types(editor)[0]).toBe("embed");
  });

  it("URL keeps the link", async () => {
    const editor = await opened();
    act(() => row("URL").click());
    expect(editor.document[0]!.content).toMatchObject([{ type: "link", href: URL_ }]);
    expect(menu()).toBeNull();
  });

  it("a click on a row applies it", async () => {
    const editor = await opened();
    act(() => row("Bookmark").click());
    expect(types(editor)[0]).toBe("embed");
  });

  it.each(["Escape", "a"])("%s closes the menu and keeps the link", async (name) => {
    const editor = await opened();
    key(name);
    expect(menu()).toBeNull();
    expect(types(editor)).toEqual(["paragraph"]);
  });

  it.each(["Enter", "Escape", "ArrowDown", "ArrowUp"])("keeps %s from the editor", async (name) => {
    await opened();
    expect(key(name).defaultPrevented).toBe(true);
  });

  it("lets a typed key through to the editor", async () => {
    await opened();
    expect(key("a").defaultPrevented).toBe(false);
  });

  it("stays open for a bare modifier key", async () => {
    await opened();
    key("Shift");
    expect(menu()).not.toBeNull();
  });

  it("closes on a click away", async () => {
    await opened();
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it("keeps editor focus when a row is pressed", async () => {
    await opened();
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      row("URL").dispatchEvent(press);
    });
    expect(press.defaultPrevented).toBe(true);
    expect(menu()).not.toBeNull();
  });

  it("closes when someone else removes the link", async () => {
    const editor = await opened();
    act(() => {
      editor.updateBlock(editor.document[0]!, { content: [text("Gone")] } as never);
    });
    expect(menu()).toBeNull();
  });
});
