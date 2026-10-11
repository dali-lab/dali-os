import { useEffect, useState } from "react";

export type UserSearchResult = { id: string; name: string; photoUrl: string | null; email: string };

export const USER_SEARCH_MIN_CHARS = 2;
const DEBOUNCE_MS = 150;

/** Debounced lookup against /api/users/search (Core/Admin only). Results are
 *  only returned while they still match the current query, so a slow reply
 *  for an earlier keystroke never shows up under a newer one. */
export function useUserSearch(query: string): UserSearchResult[] {
  const [results, setResults] = useState<{ q: string; users: UserSearchResult[] }>({ q: "", users: [] });
  useEffect(() => {
    const q = query.trim();
    if (q.length < USER_SEARCH_MIN_CHARS) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) return;
        const { users } = (await res.json()) as { users: UserSearchResult[] };
        setResults({ q, users });
      } catch {
        // Aborted by the next keystroke.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return results.q === query.trim() ? results.users : [];
}
