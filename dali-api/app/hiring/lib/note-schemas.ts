import { z } from "zod";

export const NoteVersionSchema = z.object({ content: z.string().max(100_000) });
export type NoteVersion = z.infer<typeof NoteVersionSchema>;
