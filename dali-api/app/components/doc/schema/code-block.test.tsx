// @vitest-environment jsdom
import { BlockNoteEditor } from "@blocknote/core";
import { en } from "@blocknote/core/locales";
import { locales as multiColumnLocales } from "@blocknote/xl-multi-column";
import { afterEach, describe, expect, it } from "vitest";
import { EDITOR_PRESETS } from "../features";
import { buildSchema, type DocEditorInstance } from "./build";
import { LANGUAGE_OPTIONS } from "./code-block";

// No act(): the picker mounts its own React root inside a ProseMirror node view,
// and only real scheduling surfaces a render loop between the two.
const settle = () => new Promise((r) => setTimeout(r, 50));

async function editorWith(language: string, { editable = true } = {}) {
  const editor = BlockNoteEditor.create({
    schema: buildSchema(EDITOR_PRESETS.resource),
    dictionary: { ...en, multi_column: multiColumnLocales.en },
    initialContent: [{ type: "codeBlock", props: { language }, content: "<p>hi</p>" }],
  } as never) as unknown as DocEditorInstance;
  editor.isEditable = editable;
  const root = document.createElement("div");
  document.body.append(root);
  editor.mount(root);
  await settle();
  return editor;
}

const block = () => document.querySelector('[data-content-type="codeBlock"]')!;
const trigger = () => block().querySelector<HTMLButtonElement>('button[aria-label="Code language"]')!;
const option = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((o) => o.textContent === label)!;

afterEach(() => {
  document.body.replaceChildren();
});

describe("code block language picker", () => {
  it("replaces the native select with the app Select showing the block's language", async () => {
    await editorWith("html");
    expect(block().querySelector("select")).toBeNull();
    expect(trigger().textContent).toBe("HTML");
    expect(trigger().disabled).toBe(false);
  });

  it("keeps one stable picker instead of rebuilding the block", async () => {
    await editorWith("html");
    const first = trigger();
    await settle();
    await settle();
    expect(trigger()).toBe(first);
    expect(document.querySelectorAll('button[aria-label="Code language"]')).toHaveLength(1);
  });

  it("lists every supported language", async () => {
    await editorWith("html");
    trigger().click();
    await settle();
    const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options).toEqual(LANGUAGE_OPTIONS.map((o) => o.label));
  });

  it("writes the chosen language to the block", async () => {
    const editor = await editorWith("html");
    trigger().click();
    await settle();
    option("CSS").click();
    expect(editor.document[0]!.props).toMatchObject({ language: "css" });
    await settle();
    expect(trigger().textContent).toBe("CSS");
  });

  it("is disabled when the doc is read-only", async () => {
    await editorWith("python", { editable: false });
    expect(trigger().textContent).toBe("Python");
    expect(trigger().disabled).toBe(true);
  });
});
