import { describe, it, expect } from "vitest";
import {
  ClipboardCheck,
  ClipboardList,
  FileArchive,
  FileImage,
  FileSignature,
  FileText,
  Folder,
  FolderKanban,
  ListTodo,
  NotebookPen,
  Paperclip,
  Presentation,
  Shapes,
} from "lucide-react";
import { resultIcon, TYPE_META } from "~/components/CommandPalette";

describe("resultIcon", () => {
  it("gives Drive folders, whiteboards, notebooks and decks their Drive glyph, not the document one", () => {
    expect(resultIcon({ type: "document", pageKind: "Folder" })).toBe(Folder);
    expect(resultIcon({ type: "document", pageKind: "Whiteboard" })).toBe(Shapes);
    expect(resultIcon({ type: "document", pageKind: "Notebook" })).toBe(NotebookPen);
    expect(resultIcon({ type: "document", pageKind: "Slides" })).toBe(Presentation);
  });

  it("gives an uploaded file the glyph for its file type", () => {
    expect(resultIcon({ type: "document", fileCategory: "image" })).toBe(FileImage);
    expect(resultIcon({ type: "document", fileCategory: "archive" })).toBe(FileArchive);
    expect(resultIcon({ type: "document", fileCategory: "pdf" })).toBe(FileText);
    expect(resultIcon({ type: "document", fileCategory: "other" })).toBe(Paperclip);
  });

  it("falls back to the type glyph for a plain document", () => {
    expect(resultIcon({ type: "document" })).toBe(FileText);
  });

  it("matches the Drive glyphs for forms, rubrics and agreements", () => {
    expect(resultIcon({ type: "form" })).toBe(ClipboardList);
    expect(resultIcon({ type: "rubric" })).toBe(ClipboardCheck);
    expect(resultIcon({ type: "confidentialityAgreement" })).toBe(FileSignature);
  });

  it("shows tasks as tasks, apart from projects", () => {
    expect(resultIcon({ type: "task" })).toBe(ListTodo);
    expect(resultIcon({ type: "project" })).toBe(FolderKanban);
    expect(TYPE_META.task.section).toBe("Tasks");
    expect(TYPE_META.project.section).toBe("Projects");
  });
});
