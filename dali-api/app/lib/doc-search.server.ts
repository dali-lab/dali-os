// Document-content search: the index write path and the two-pass query behind
// the `document` category in search.server.ts.
//
// Page bodies live as Y.Doc bytes in CollabDocument.state, which no SQL query
// can see into — so site-wide search could only ever match Page.title. This
// module maintains a flattened plain-text mirror per page (PageSearchIndex) and
// searches it.
//
// Two passes, because they answer different questions:
//
//   1. EXACT — `tsv @@ tsquery`, ordered by ts_rank. Stemmed ("designers"
//      finds "design") and prefix-matched, so the palette keeps returning
//      results while someone is still typing a word. Handles every correctly
//      spelled query.
//   2. FUZZY — pg_trgm word_similarity, run ONLY when pass 1 came up short.
//      Trigram similarity is spelling-tolerant where a lexeme match is not:
//      "onbaording" shares no lexeme with "onboarding" but scores 0.47 against
//      it. This pass also covers titles, so a misspelled title still finds its
//      page even when the body was never indexed.
//
// Both passes are GIN-indexed (see the migration). The fuzzy pass costs an
// extra round trip, which is why it is a fallback rather than an OR.

import { prisma } from "~/lib/db";

// Longest body text kept per page. Bodies run to a few thousand characters;
// this bounds the pathological ones so a single row can't dominate the table
// or push to_tsvector toward its 1MB input ceiling.
export const INDEX_MAX_CHARS = 20_000;

// word_similarity floor for the fuzzy pass. Measured against real typos: a
// dropped letter scores ~0.6-0.7, a transposition ~0.43-0.47, while unrelated
// text sits below 0.3. 0.4 clears the common single-typo shapes with headroom
// above the noise.
const FUZZY_THRESHOLD = 0.4;

// Below this, a query is too short for trigram similarity to mean anything —
// almost any document matches a 3-character fragment. The prefix-matching
// exact pass already serves short queries well.
const FUZZY_MIN_QUERY_LENGTH = 4;

// Leading excerpt used as the snippet for a fuzzy hit. A misspelled query has
// no lexeme to anchor ts_headline on, so there is no matched region to quote.
const FUZZY_SNIPPET_CHARS = 160;

// The palette shows a snippet on one truncated line, so the block newlines
// that survive ts_headline are folded back into spaces.
function oneLine(snippet: string | null): string {
  return (snippet ?? "").replace(/\s+/g, " ").trim();
}

export interface DocContentHit {
  pageId: string;
  title: string;
  iconEmoji: string | null;
  /** Matched region of the body, or a leading excerpt for a fuzzy hit. */
  snippet: string;
  /** True when this came from the fuzzy pass — the query did not match exactly. */
  fuzzy: boolean;
}

/**
 * Collapse a page body into the form stored in the index: runs of horizontal
 * whitespace flattened, blank-line runs capped, and the whole thing truncated.
 * Block structure carries no search meaning, so only the words are kept.
 */
export function normalizeIndexText(text: string): string {
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, INDEX_MAX_CHARS);
}

/**
 * Write (or refresh) a page's row in the content index. `sourceUpdatedAt` is
 * the CollabDocument's updatedAt, which the sweep job compares against to find
 * stale rows without decoding any Y.Doc state.
 *
 * A page whose body is now empty is dropped from the index rather than stored
 * as an empty string, so it stops matching every fuzzy query.
 *
 * Raw SQL because `tsv` is a tsvector: Prisma models it as Unsupported() and
 * omits it from generated writes, so the lexeme vector has to be computed in
 * the same statement that writes the text it mirrors.
 */
export async function indexPageBody(
  pageId: string,
  plainText: string,
  sourceUpdatedAt: Date,
): Promise<void> {
  const content = normalizeIndexText(plainText);
  if (!content) {
    await prisma.pageSearchIndex.deleteMany({ where: { pageId } });
    return;
  }

  await prisma.$executeRaw`
    INSERT INTO "PageSearchIndex" ("pageId", "content", "tsv", "sourceUpdatedAt", "indexedAt")
    VALUES (
      ${pageId},
      ${content},
      to_tsvector('english', ${content}),
      ${sourceUpdatedAt},
      now()
    )
    ON CONFLICT ("pageId") DO UPDATE SET
      "content" = EXCLUDED."content",
      "tsv" = EXCLUDED."tsv",
      "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt",
      "indexedAt" = now()
  `;
}

type ExactRow = {
  id: string;
  title: string;
  iconEmoji: string | null;
  snippet: string | null;
};

type FuzzyRow = {
  id: string;
  title: string;
  iconEmoji: string | null;
  snippet: string | null;
};

/**
 * Search page bodies, best match first. Returns at most `limit` hits; the
 * caller ranks them against the other search categories.
 *
 * Archived pages are excluded, matching the title search this sits alongside.
 * No further permission filtering: any authenticated member can already open
 * any live page by URL (only editing is gated), so this discloses nothing the
 * existing document search does not.
 */
export async function searchPageContent(q: string, limit: number): Promise<DocContentHit[]> {
  const query = q.trim();
  if (!query) return [];

  const exact = await exactPass(query, limit);
  if (exact.length >= limit || query.length < FUZZY_MIN_QUERY_LENGTH) return exact;

  const fuzzy = await fuzzyPass(query, limit);
  const seen = new Set(exact.map((h) => h.pageId));
  return [...exact, ...fuzzy.filter((h) => !seen.has(h.pageId))].slice(0, limit);
}

/**
 * Lexeme match, ranked by ts_rank.
 *
 * The tsquery is built by running the user's text through to_tsvector and
 * appending `:*` to each lexeme. That does three things at once: it stems the
 * query the same way the index was stemmed, it drops stopwords, and it makes
 * the terms prefix matches so a half-typed word still hits. It is also the
 * only injection-safe way to reach to_tsquery — the tokenizer discards the
 * operator characters (`&`, `|`, `!`, `(`, `)`, `:`) that would otherwise be
 * either a syntax error or an injection point. An all-stopword query yields an
 * empty tsquery, which matches nothing.
 *
 * ts_headline runs in the outer select, over the already-limited rows, because
 * generating a highlight is far more expensive than scoring one. It is left on
 * its default (cover-density) algorithm rather than MaxFragments, which opens
 * the excerpt at the match instead of padding it with the words before.
 */
async function exactPass(query: string, limit: number): Promise<DocContentHit[]> {
  const rows = await prisma.$queryRaw<ExactRow[]>`
    SELECT
      t.id,
      t.title,
      t."iconEmoji",
      ts_headline(
        'english',
        t.content,
        to_tsquery('english', array_to_string(
          array(SELECT l || ':*' FROM unnest(tsvector_to_array(to_tsvector('english', ${query}))) AS l),
          ' & '
        )),
        'StartSel="", StopSel="", MaxWords=16, MinWords=8, ShortWord=3'
      ) AS snippet
    FROM (
      SELECT
        p.id,
        p.title,
        p."iconEmoji",
        i.content,
        ts_rank(
          i.tsv,
          to_tsquery('english', array_to_string(
            array(SELECT l || ':*' FROM unnest(tsvector_to_array(to_tsvector('english', ${query}))) AS l),
            ' & '
          ))
        ) AS rank
      FROM "PageSearchIndex" i
      JOIN "Page" p ON p.id = i."pageId"
      WHERE p."archivedAt" IS NULL
        AND i.tsv @@ to_tsquery('english', array_to_string(
          array(SELECT l || ':*' FROM unnest(tsvector_to_array(to_tsvector('english', ${query}))) AS l),
          ' & '
        ))
      ORDER BY rank DESC
      LIMIT ${limit}
    ) t
    ORDER BY t.rank DESC
  `;

  return rows.map((r) => ({
    pageId: r.id,
    title: r.title,
    iconEmoji: r.iconEmoji,
    snippet: oneLine(r.snippet),
    fuzzy: false,
  }));
}

/**
 * Trigram match on title and body, for queries the lexeme pass could not
 * spell-match.
 *
 * The two sources are UNIONed rather than OR'd so each branch can use its own
 * GIN index — an OR spanning both tables degrades to a join filter. Titles are
 * included here (and only here) because a typo'd title is the most common way
 * to miss a document, and it works even for pages with no index row yet.
 *
 * `<%` reads its cutoff from pg_trgm.word_similarity_threshold, whose default
 * (0.6) is stricter than typos warrant, so the threshold is set for the
 * transaction. SET takes no bind parameters, hence Unsafe — the interpolated
 * value is a numeric constant from this module, never caller input.
 *
 * The `searchable` guard stops a query with nothing to search for from
 * matching everything: "the and" produces no lexemes, so the exact pass finds
 * nothing, and without the guard trigram similarity would then happily match
 * the stopwords themselves in every document in the lab. A misspelled word is
 * still a lexeme, so real typos are unaffected.
 */
async function fuzzyPass(query: string, limit: number): Promise<DocContentHit[]> {
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL pg_trgm.word_similarity_threshold = ${FUZZY_THRESHOLD}`,
    );
    return tx.$queryRaw<FuzzyRow[]>`
      WITH q AS (
        SELECT to_tsvector('english', ${query}) <> ''::tsvector AS searchable
      ),
      hits AS (
        SELECT p.id AS page_id, word_similarity(${query}, p.title) AS sim, NULL::text AS content
        FROM "Page" p, q
        WHERE q.searchable
          AND p."archivedAt" IS NULL
          AND ${query} <% p.title
        UNION ALL
        SELECT i."pageId", word_similarity(${query}, i.content), i.content
        FROM "PageSearchIndex" i, q
        WHERE q.searchable
          AND ${query} <% i.content
      )
      SELECT
        p.id,
        p.title,
        p."iconEmoji",
        left(max(h.content), ${FUZZY_SNIPPET_CHARS}) AS snippet
      FROM hits h
      JOIN "Page" p ON p.id = h.page_id
      WHERE p."archivedAt" IS NULL
      GROUP BY p.id, p.title, p."iconEmoji"
      ORDER BY max(h.sim) DESC, p.title ASC
      LIMIT ${limit}
    `;
  });

  return rows.map((r) => ({
    pageId: r.id,
    title: r.title,
    iconEmoji: r.iconEmoji,
    snippet: oneLine(r.snippet),
    fuzzy: true,
  }));
}
