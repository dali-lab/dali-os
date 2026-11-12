import { z } from "zod";

export const existingNotebookSchema = z.object({
  existingId: z.string().min(1),
});

/** Where a new notebook is filed: General, Core's own folder, or one project's. */
export const notebookSpaceSchema = z.union([
  z.object({ kind: z.literal("lab") }).strict(),
  z.object({ kind: z.literal("core") }).strict(),
  z.object({ kind: z.literal("project"), projectId: z.string().min(1) }).strict(),
]);

export const newNotebookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  templatePageId: z.string().min(1).nullable().optional(),
  space: notebookSpaceSchema.optional(),
  folderPageId: z.string().min(1).optional(),
});

/** Which notebook a meeting's note files into: one that exists, or one to make. */
export const notebookChoiceSchema = z.union([existingNotebookSchema.strict(), newNotebookSchema.strict()]);

export type ExistingNotebookChoice = z.infer<typeof existingNotebookSchema>;
export type NotebookSpaceChoice = z.infer<typeof notebookSpaceSchema>;
export type NewNotebookChoice = z.infer<typeof newNotebookSchema>;
export type NotebookChoice = ExistingNotebookChoice | NewNotebookChoice;

export function isExistingChoice(choice: NotebookChoice): choice is ExistingNotebookChoice {
  return "existingId" in choice;
}
