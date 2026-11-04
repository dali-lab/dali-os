import type { AskSource, CitedSource } from "./sources";

export type AskEvent =
  | { type: "status"; label: string }
  | { type: "sources"; sources: AskSource[] }
  | { type: "text"; delta: string }
  | { type: "retract" }
  | { type: "done"; answer: string; sources: CitedSource[] }
  | { type: "error"; message: string };
