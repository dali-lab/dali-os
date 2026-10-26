import { createSearchCache, searchWithCache } from "~/lib/search-cache";

export type MentionUser = {
  id: string;
  name: string;
  handle: string;
  photoUrl?: string | null;
};

export type MentionPage = {
  id: string;
  title: string;
  iconEmoji?: string | null;
};

async function fetchMentionableUsers(q: string): Promise<MentionUser[] | null> {
  try {
    const res = await fetch(`/api/mentions/search?q=${encodeURIComponent(q)}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { members?: MentionUser[] };
    return data.members ?? [];
  } catch {
    return null;
  }
}

async function fetchMentionablePages(q: string): Promise<MentionPage[] | null> {
  try {
    const res = await fetch(`/api/mentions/pages?q=${encodeURIComponent(q)}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { pages?: MentionPage[] };
    return data.pages ?? [];
  } catch {
    return null;
  }
}

export const mentionUserCache = createSearchCache<MentionUser>({
  fetch: fetchMentionableUsers,
  matches: (user, q) => `${user.name} ${user.handle}`.toLowerCase().includes(q),
});

export const mentionPageCache = createSearchCache<MentionPage>({
  fetch: fetchMentionablePages,
  matches: (page, q) => (page.title || "Untitled").toLowerCase().includes(q),
});

/** Member-search endpoint (session-authed); fills the shared cache. */
export async function searchMentionableUsers(q: string): Promise<MentionUser[]> {
  return (await mentionUserCache.load(q)) ?? [];
}

/** Page-mention search endpoint (session-authed, permission-scoped); fills the shared cache. */
export async function searchMentionablePages(q: string): Promise<MentionPage[]> {
  return (await mentionPageCache.load(q)) ?? [];
}

export type MentionSearch<T> = (q: string, onFresh?: () => void) => Promise<T[]>;

export const cachedUserSearch: MentionSearch<MentionUser> = (q, onFresh) =>
  searchWithCache(mentionUserCache, q, onFresh);
export const cachedPageSearch: MentionSearch<MentionPage> = (q, onFresh) =>
  searchWithCache(mentionPageCache, q, onFresh);
