import { z } from "zod";

export const notebookLocationSchema = z
  .object({
    workspaceType: z.enum(["Lab", "Project"]),
    workspaceId: z.string().min(1).nullable(),
    parentPageId: z.string().min(1).nullable(),
  })
  .refine((l) => (l.workspaceType === "Project" ? !!l.workspaceId : l.workspaceId === null), {
    message: "workspaceId must be set for Project and null for Lab",
  });

export const existingNotebookSchema = z.object({ existingId: z.string().min(1) });

export const newNotebookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  location: notebookLocationSchema.nullable().optional(),
  templatePageId: z.string().min(1).nullable().optional(),
});

/** Which notebook a meeting's note files into: one that exists, or one to make. */
export const notebookChoiceSchema = z.union([existingNotebookSchema, newNotebookSchema]);

export type ExistingNotebookChoice = z.infer<typeof existingNotebookSchema>;
export type NewNotebookChoice = z.infer<typeof newNotebookSchema>;
export type NotebookChoice = ExistingNotebookChoice | NewNotebookChoice;

export function isExistingChoice(choice: NotebookChoice): choice is ExistingNotebookChoice {
  return "existingId" in choice;
}
