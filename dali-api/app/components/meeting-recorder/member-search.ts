import { useEffect, useRef, useState } from "react";

export type SearchMember = { id: string; name: string; handle: string };

const SEARCH_MIN_CHARS = 2;
const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 8;

async function searchLabMembers(query: string): Promise<SearchMember[]> {
  try {
    const res = await fetch(`/api/mentions/search?q=${encodeURIComponent(query)}`, { credentials: "include" });
    if (!res.ok) return [];
    const data = (await res.json()) as { members?: SearchMember[] };
    return (data.members ?? []).slice(0, SEARCH_LIMIT);
  } catch {
    return [];
  }
}

export function isSearchableQuery(query: string): boolean {
  return query.trim().length >= SEARCH_MIN_CHARS;
}

export function useLabMemberSearch(): { query: string; setQuery: (q: string) => void; results: SearchMember[] } {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMember[]>([]);
  const seqRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!isSearchableQuery(q)) {
      setResults([]);
      return;
    }
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      void searchLabMembers(q).then((members) => {
        if (seq === seqRef.current) setResults(members);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  return { query, setQuery, results };
}
