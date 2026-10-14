import { z } from "zod";

export const existingNotebookSchema = z.object({
  existingId: z.string().min(1),
});

export const newNotebookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  templatePageId: z.string().min(1).nullable().optional(),
});

/** Which notebook a meeting's note files into: one that exists, or one to make. */
export const notebookChoiceSchema = z.union([existingNotebookSchema.strict(), newNotebookSchema.strict()]);

export type ExistingNotebookChoice = z.infer<typeof existingNotebookSchema>;
export type NewNotebookChoice = z.infer<typeof newNotebookSchema>;
export type NotebookChoice = ExistingNotebookChoice | NewNotebookChoice;

export function isExistingChoice(choice: NotebookChoice): choice is ExistingNotebookChoice {
  return "existingId" in choice;
}
