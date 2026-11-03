import { ALL_TERMS } from "~/lib/terms.shared";

// The term the notes grid is scoped to: an id, or "" for any term. With no
// term in the URL it opens on the current term. ?termId= is the old param,
// where "" meant any term.
export function browseTermId(params: URLSearchParams, currentTermId: string | null): string {
  const legacy = params.get("termId");
  const term = params.get("term") ?? (legacy === "" ? ALL_TERMS : legacy);
  if (term === null) return currentTermId ?? "";
  return term === ALL_TERMS ? "" : term;
}
