// @vitest-environment jsdom
import { BlockNoteEditor } from "@blocknote/core";
import { en } from "@blocknote/core/locales";
import { locales as multiColumnLocales } from "@blocknote/xl-multi-column";
import { TextSelection } from "prosemirror-state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITOR_PRESETS, type EditorPresetName } from "./features";
import { filesToUpload, MediaDropExtension, mediaDropKey } from "./media-drop";
import { docPasteHandler } from "./paste-embed";
import { buildSchema, type DocEditorInstance } from "./schema/build";

const png = (name = "shot.png") => new File(["x"], name, { type: "image/png" });
const pdf = () => new File(["x"], "brief.pdf", { type: "application/pdf" });

function transfer(data: Record<string, string>, files: File[] = []): DataTransfer {
  const types = files.length ? [...Object.keys(data), "Files"] : Object.keys(data);
  return { types, getData: (type: string) => data[type] ?? "", files } as unknown as DataTransfer;
}

const text = (value: string) => ({ type: "text", text: value, styles: {} });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const cell = (value: string) => ({ type: "tableCell", content: [text(value)], props: {} });
const table = {
  type: "table",
  content: { type: "tableContent", rows: [{ cells: [cell("A1"), cell("B1")] }] },
};

function editorWith(
  content: unknown[],
  { preset = "document", upload }: { preset?: EditorPresetName; upload?: ((file: File) => Promise<string>) | null } = {},
) {
  const uploadFile = upload === undefined ? vi.fn(async (file: File) => `/up/${file.name}`) : (upload ?? undefined);
  const editor = BlockNoteEditor.create({
    schema: buildSchema(EDITOR_PRESETS[preset]),
    dictionary: { ...en, multi_column: multiColumnLocales.en },
    initialContent: content,
    uploadFile,
    extensions: [MediaDropExtension()],
  } as never) as unknown as DocEditorInstance;
  const root = document.createElement("div");
  document.body.append(root);
  editor.mount(root);
  return { editor, uploadFile };
}

function paste(editor: DocEditorInstance, data: DataTransfer) {
  const defaultPasteHandler = vi.fn(() => true);
  const handled = docPasteHandler({ event: { clipboardData: data } as ClipboardEvent, editor, defaultPasteHandler });
  return { handled, defaultPasteHandler };
}

function cursorIn(editor: DocEditorInstance, needle: string) {
  const view = editor.prosemirrorView;
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text === needle) at = pos + 1;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

const shape = (editor: DocEditorInstance) =>
  editor.document.map((block) => ({ type: block.type, url: (block.props as { url?: string }).url }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.replaceChildren();
});

describe("filesToUpload", () => {
  it.each([
    ["only files", {}],
    ["a copied browser image", { "text/html": '<meta charset="utf-8"><img src="https://example.com/a.png" alt="a">' }],
    ["a copied Google Docs image", { "text/html": '<b id="docs-internal-guid-1"><span><img src="https://lh3.example.com/x"></span></b>' }],
    ["a Finder file with its name as text", { "text/plain": "shot.png", "text/uri-list": "file:///shot.png" }],
  ])("uploads %s", (_label, data) => {
    const file = png();
    expect(filesToUpload(transfer(data, [file]))).toEqual([file]);
  });

  it.each([
    ["a spreadsheet range with its picture", { "text/html": "<table><tr><td>Q3</td><td>42</td></tr></table>" }, [png()]],
    ["blocks copied from a doc", { "blocknote/html": "<img>", "text/html": "<img>" }, [png()]],
    ["text without files", { "text/plain": "hello" }, []],
  ])("leaves %s to the default paste", (_label, data, files) => {
    expect(filesToUpload(transfer(data, files))).toEqual([]);
  });

  it("returns nothing without a clipboard", () => {
    expect(filesToUpload(null)).toEqual([]);
  });
});

describe("pasting files", () => {
  it("turns an empty line into the uploaded image", async () => {
    const { editor, uploadFile } = editorWith([paragraph()]);
    editor.setTextCursorPosition(editor.document[0]!, "end");
    const { handled, defaultPasteHandler } = paste(editor, transfer({ "text/html": "<img src=x>" }, [png()]));
    expect(handled).toBe(true);
    expect(defaultPasteHandler).not.toHaveBeenCalled();
    await settle();
    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), editor.document[0]!.id);
    expect(shape(editor)[0]).toEqual({ type: "image", url: "/up/shot.png" });
  });

  it("puts the image below a line that has text", async () => {
    const { editor } = editorWith([paragraph(text("caption"))]);
    editor.setTextCursorPosition(editor.document[0]!, "end");
    paste(editor, transfer({}, [png()]));
    await settle();
    expect(shape(editor).slice(0, 2)).toEqual([
      { type: "paragraph", url: undefined },
      { type: "image", url: "/up/shot.png" },
    ]);
  });

  it("puts the image below the table when pasting in a cell", async () => {
    const { editor } = editorWith([table, paragraph(text("after"))]);
    cursorIn(editor, "B1");
    paste(editor, transfer({}, [png()]));
    await settle();
    expect(shape(editor).map((b) => b.type).slice(0, 3)).toEqual(["table", "image", "paragraph"]);
    expect(editor.document[0]!.content).toMatchObject({ rows: [{ cells: [{}, {}] }] });
  });

  it("keeps several files in the order they were copied", async () => {
    const { editor } = editorWith([paragraph(text("x"))]);
    editor.setTextCursorPosition(editor.document[0]!, "end");
    paste(editor, transfer({}, [png("one.png"), pdf(), png("two.png")]));
    await settle();
    expect(shape(editor).slice(1, 4)).toEqual([
      { type: "image", url: "/up/one.png" },
      { type: "file", url: "/up/brief.pdf" },
      { type: "image", url: "/up/two.png" },
    ]);
  });

  it("skips files the surface has no block for", async () => {
    const { editor, uploadFile } = editorWith([paragraph(text("x"))], { preset: "notes" });
    editor.setTextCursorPosition(editor.document[0]!, "end");
    paste(editor, transfer({}, [pdf(), png()]));
    await settle();
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(shape(editor).map((b) => b.type).slice(0, 2)).toEqual(["paragraph", "image"]);
  });

  it("leaves the empty image block when the upload fails", async () => {
    const { editor } = editorWith([paragraph()], { upload: () => Promise.reject(new Error("Too big")) });
    editor.setTextCursorPosition(editor.document[0]!, "end");
    paste(editor, transfer({}, [png()]));
    await settle();
    expect(shape(editor)[0]).toEqual({ type: "image", url: "" });
  });

  it("falls back to the default paste on a surface without uploads", () => {
    const { editor } = editorWith([paragraph()], { preset: "field", upload: null });
    editor.setTextCursorPosition(editor.document[0]!, "end");
    const { defaultPasteHandler } = paste(editor, transfer({}, [png()]));
    expect(defaultPasteHandler).toHaveBeenCalled();
  });
});

describe("dropping files", () => {
  function drop(editor: DocEditorInstance, data: DataTransfer, at: string, clientY = 0) {
    let pos = -1;
    editor.prosemirrorView.state.doc.descendants((node, p) => {
      if (pos < 0 && node.isText && node.text === at) pos = p + 1;
    });
    editor.prosemirrorView.posAtCoords = () => ({ pos, inside: -1 });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: data, clientX: 0, clientY });
    editor.prosemirrorView.dom.dispatchEvent(event);
    return event;
  }

  it("puts a file dropped on a table below the table", async () => {
    const { editor } = editorWith([table, paragraph(text("after"))]);
    const event = drop(editor, transfer({ "text/html": "<img src=x>" }, [png()]), "A1");
    expect(event.defaultPrevented).toBe(true);
    await settle();
    expect(shape(editor).map((b) => b.type).slice(0, 3)).toEqual(["table", "image", "paragraph"]);
  });

  it("puts a file dropped on the top half of a line above it", async () => {
    const { editor } = editorWith([paragraph(text("first")), paragraph(text("second"))]);
    const second = editor.prosemirrorView.dom.querySelector(`[data-id="${editor.document[1]!.id}"]`)!;
    second.getBoundingClientRect = () => ({ top: 100, bottom: 140 }) as DOMRect;
    drop(editor, transfer({}, [png()]), "second", 105);
    await settle();
    expect(shape(editor).map((b) => b.type).slice(0, 3)).toEqual(["paragraph", "image", "paragraph"]);
  });

  it("leaves a drop of text and its picture alone", () => {
    const { editor, uploadFile } = editorWith([paragraph(text("first"))]);
    const view = editor.prosemirrorView;
    const event = new Event("drop", { cancelable: true }) as DragEvent;
    Object.assign(event, { dataTransfer: transfer({ "text/html": "<p>Q3 numbers</p>" }, [png()]) });
    const handled = mediaDropKey.get(view.state)!.props.handleDOMEvents!.drop!.call(undefined as never, view, event);
    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
