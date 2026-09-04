-- Document content search index.
--
-- Site-wide search matched Page.title only; a page's body lived exclusively as
-- Y.Doc bytes in CollabDocument.state and was invisible to search. This adds a
-- flattened plain-text mirror per page plus the two GIN indexes the search
-- query needs:
--
--   * "tsv"      — stemmed lexeme vector for the exact pass, ranked by ts_rank.
--   * "content"  — trigram index for the typo-tolerant fallback (query <% content).
--
-- Page.title gets a trigram index for the same reason, so a misspelled title
-- still finds its document. The extension is required before either
-- gin_trgm_ops index can be created.
--
-- Additive only: a new table plus three indexes. Rows are populated by the
-- collab store hook and backfilled by the `doc-search-index` job; an empty
-- table simply means content search returns nothing until the sweep runs.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "PageSearchIndex" (
    "pageId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tsv" tsvector,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageSearchIndex_pkey" PRIMARY KEY ("pageId")
);

-- CreateIndex
CREATE INDEX "PageSearchIndex_tsv_idx" ON "PageSearchIndex" USING GIN ("tsv");

-- CreateIndex
CREATE INDEX "PageSearchIndex_content_idx" ON "PageSearchIndex" USING GIN ("content" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Page_title_idx" ON "Page" USING GIN ("title" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "PageSearchIndex" ADD CONSTRAINT "PageSearchIndex_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
