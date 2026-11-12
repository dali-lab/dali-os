# BlockNote Follow-ups — Unused Features & Document Gaps

Post-migration roadmap candidates, written 2026-07-31 after PR #1098 (TipTap → BlockNote migration + document-page UX overhaul). Grounded against the installed `@blocknote/*@0.52.1` packages and the current wiring in `dali-api/app/components/doc/`.

**STATUS 2026-08-01: BUILT.** A1–A8 and B1–B7 all landed on `feat/blocknote-migration` (PR #1098, merged head `517626d7`) via a 10-agent parallel build. Deliberate skips: B8 (parked), B9 (deferred to the sidekick app), docx export, audio blocks, h4–h6 headings. A5 (y-indexeddb) turned out to already be wired. B6 AI slash ships dark until `ANTHROPIC_API_KEY` is set server-side. Three additive migrations ride along (DocCommentReaction, PageLink, Page.isTemplate).

XL-tier packages (multi-column, docx/odt exporters, xl-ai) are deliberately excluded — GPL-3.0/$195mo, ruled out in `specs/blocknote-migration.md` (D-series decisions).

---

## A. BlockNote features we own but haven't wired

Mostly configuration, not construction. Roughly ordered cheapest-first.

### A1. Advanced tables
- [ ] Split/merge cells, header rows/columns, cell background + text colors.
- All exist behind a `tables: { splitCells, cellBackgroundColor, cellTextColor, headers }` editor option (see `@blocknote/core` `BlockNoteEditor.d.ts`) that we never set in `DocEditorImpl.tsx` — tables today are the basic grid.
- Same `table` block type, so server codecs / legacy converters are unaffected. Verify export (md/html/pdf) renders headers + colors sanely.

### A2. Emoji picker
- [ ] `:shortcode:` suggestion menu — explicitly disabled today (`emojiPicker={false}` in `DocEditorImpl.tsx`).
- One flag plus a `GridSuggestionMenuController` for the `:` trigger.

### A3. Toggle headings + h4–h6
- [ ] Headings accept `isToggleable` (Notion-style collapsible sections — bigger than the toggle *lists* we already have) and a `levels` option beyond the default h1–h3.
- Check DocToc + export walkers if levels are extended.

### A4. File / video / audio blocks
- [ ] In `defaultBlockSpecs`, deliberately excluded in `schema/build.ts` ("app never had"). S3 upload pipeline already exists (`doc/upload.ts`).
- Generic file-attachment block (PDFs, decks dropped into a doc) is the valuable one for Notion parity; video next; audio probably never.
- Real work is schema registration + export codecs (`app/collab/blocknote-server.ts`, export-html/pdf) + `blocksToPlainText` walker.

### A5. Offline / instant-load cache (y-indexeddb)
- [ ] `y-indexeddb@^9.0.12` is **already in package.json** (legacy holdover) and officially supported by BlockNote.
- Docs open instantly from local cache and tolerate flaky WiFi. Wire alongside the Hocuspocus provider in `doc/collab-doc.ts`.
- Mind the refcounted Y.Doc cache — one IndexeddbPersistence per room, destroyed with the doc.

### A6. Comment reactions
- [ ] Disabled via `DaliThreadStoreAuth` because `DocComment` has nowhere to store them.
- JSON column on `DocComment` + store/API support + remove the auth block. Migration required (additive, safe).

### A7. Page-break block
- [ ] `PageBreak` block exists in core with its own slash items. Only pays off alongside print/PDF styling (see C7) — bundle them.

### A8. Side-menu / drag-handle customization
- [ ] Custom items on the ⋮⋮ handle: "Comment on this block", block color, duplicate block.
- Pure React customization of the side menu; no schema impact.

---

## B. Document gaps BlockNote won't hand us (product-level)

### B1. Find & replace in a doc
- [ ] Neither BlockNote nor our chrome has it; GDocs/Notion both do. Hand-rolled: walk blocks + highlight decorations; replace via block updates.

### B2. Page mentions & backlinks
- [ ] `@` only resolves *people* today (`schema/mention.tsx`). Mentioning a page/doc as a live link + a backlinks panel is the biggest Notion-parity gap.
- Feeds the graph-view / "Connections" IA direction. Needs: second mention kind (or `#` trigger), server resolution, backlink index (queryable — mentions already extracted server-side in `mentions.server.ts`, extend to page refs).

### B3. Doc templates & duplicate
- [ ] Mentor-note templates exist; no general "duplicate doc" or template gallery for pages.
- Duplicate = copy Y.Doc fragment + Page row; templates = flag + picker on create.

### B4. Legacy features consciously not ported (small)
- [ ] Presence follow-mode — click an avatar → jump to that user's cursor.
- [ ] Mention deep-links — notification link scrolls to/flashes the mention (comment deep-links work now; mentions don't).

### B5. Live comment sync
- [ ] Thread bodies arrive on refetch, not CRDT-instant (accepted tradeoff of the DocComment row store — see D2 in the migration plan).
- Cheap improvement: piggyback the existing SSE stream (`/api/notifications/stream`) or a doc-scoped channel to nudge open docs to refetch threads.

### B6. AI slash command
- [ ] Roadmap initiative (see roadmap-july2026). Custom slash-menu items calling a server-side Anthropic endpoint — insert/transform blocks via `markdownToBlocks`. No xl-ai needed.

### B7. Sharing & output
- [ ] Print stylesheet (bundle with A7 page breaks).
- [ ] "Import markdown" action — `markdownToBlocks` server codec already exists, this is nearly free.
- [ ] docx export only if someone actually asks (hand-rolled; XL exporter is out).

### B8. Suggested edits / track changes
- [ ] GDocs' review mode. Nothing off-the-shelf in BlockNote or y-prosemirror; research-grade. **Parked** unless a real workflow demands it.

### B9. Mobile editing
- [ ] BlockNote's known weak spot. Either a deliberate polish pass (toolbar reachability, selection handles, keyboard-safe floating UI) or explicitly defer to the sidekick-app strategy.

---

## Suggested sequencing (fall readiness)

1. **Config PR**: A1 tables + A2 emoji + A3 toggle headings — one small PR.
2. **A4 file/video blocks** — highest-value new capability for Notion replacement.
3. **B2 page mentions** — biggest parity gap, unlocks backlinks/graph later.
4. **A5 y-indexeddb + B5 SSE comment nudges** — perceived-speed & liveness pass.
5. Everything else opportunistically; B8 stays parked.
