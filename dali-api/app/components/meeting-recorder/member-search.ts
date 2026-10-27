import { useEffect, useState } from "react";
import { mentionUserCache } from "~/lib/mention-search";
import { searchWithCache } from "~/lib/search-cache";

export type SearchMember = { id: string; name: string; handle: string };

const SEARCH_MIN_CHARS = 2;
const SEARCH_LIMIT = 8;

export function isSearchableQuery(query: string): boolean {
  return query.trim().length >= SEARCH_MIN_CHARS;
}

export function useLabMemberSearch(): { query: string; setQuery: (q: string) => void; results: SearchMember[] } {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMember[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!isSearchableQuery(q)) {
      setResults([]);
      return;
    }
    let active = true;
    const show = (items: SearchMember[]) => {
      if (active) setResults(items.slice(0, SEARCH_LIMIT));
    };
    void searchWithCache(mentionUserCache, q, () => show(mentionUserCache.peek(q)?.items ?? [])).then(show);
    return () => {
      active = false;
    };
  }, [query]);

  return { query, setQuery, results };
}
