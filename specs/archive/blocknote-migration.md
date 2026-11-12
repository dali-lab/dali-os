# BlockNote migration — implementation plan

_**BUILT 2026-07-31 — PR #1098** (`feat/blocknote-migration`, worktree `.claude/worktrees/blocknote-migration`): phases 1–7 shipped as one consolidated PR via 4 waves of parallel sub-agents (Wave 0 contract → Wave 1 CORE+SERVER → Wave 2 five surface agents → Wave 3 comments+deletion) + full Playwright verification + fix pass. Gates at PR: typecheck 0 app errors, 2,507/2,507 tests, build clean. Key fixes beyond plan: yUndoPlugin destroy-neuter (undo dies on editable toggles otherwise) and **server decode must clone live Y.Docs** (y-prosemirror deletes undecodable content from the shared doc — found when inline-comment marks vanished). Known gaps listed in the PR. Post-merge: optional sweep `scripts/convert-to-blocknote.ts`; verify S3 upload + mobile/desktop smoke on preview._

_v2.1, 2026-07-31. Status at build time: **ready for Kiran's sign-off**. v1 was reviewed exhaustively (Fable sub-agent, adversarial pass over codebase claims, BlockNote v0.52.x APIs, coherence, and prod failure modes); v2 incorporated all findings (corrected surface inventory; added consumers: public-api, form-question bodies, education renderers; live-server conversion hazards). v2.1 per Kiran: conversion is a **one-time guarded script**, not a registry job — job machinery is overengineering at ~10 rich docs. Census SQL ready at `dali-api/scripts/blocknote-census.sql`. Supersedes the "no blocks" clause of the editor-consolidation north star (2026-07-30); everything-collaborative is unchanged._

**Why now:** the current stack works but is brittle in ways that live in our ~6,500 LOC of hand-assembled glue (Yjs UndoManager duck-typing around ESM double-bundling, editor↔viewer node-stripping parity, StrictMode doc-cache refcounting, suggestion-popup positioning, dual-toolbar state sync). BlockNote's core product *is* that glue, battle-tested (La Suite/gov, OpenProject 17 — which pairs BlockNote with Hocuspocus, our exact topology). Heavy usage starts fall 2026; today ~10 collab docs have rich content beyond text (verify via census, below) and the signing service is unused — migration is cheap now, monotonically more expensive later.

---

## Decisions (locked unless Kiran vetoes)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Scope | **Everything migrates — including signing.** One editor system end-state; full TipTap-layer deletion. | Kiran: "nice to have 1 system only." **Census correction (2026-07-31): 52 `SigningSignature` rows exist** — almost certainly confidentiality signatures migrated in when signing replaced the legacy Confidentiality tables (#1089), not new usage. Authoring side is still trivial (2 documents / 2 versions / 2 bindings). Consequence: **frozen archives are never transcoded** — pre-migration `frozenBody` rows render via a retained legacy walker (see Phase 6/7); legal artifacts stay byte-identical. **Pause the scheduled issuance job** until Phase 6 completes. Fallback: signing carve-out remains possible late (Phase 6 gate). |
| D2 | Comments | **BlockNote comment UI + custom `ThreadStore` backed by `DocComment`.** Scope-checked: the `ThreadStore` contract is ~12 methods with a *synchronous* `getThreads(): Map` + `subscribe()` reactive model, so the store needs a client-side cache hydrated from a loader + updated over the existing collab/SSE channel; `DocComment.body` (plain String) ↔ BlockNote rich `CommentBody` needs a to/from-text mapping (notify()/digests read text); reactions have no DocComment equivalent (omit — UI hides them). BlockNote comments require collab mode; `file`/`pagedoc` comment targets (incl. `fileId`/`versionId` pinning) keep the standalone CommentsRail path unchanged. | Comments stay queryable in Postgres; notify(), rails, digests keep working; handrolled decoration/anchor plumbing deleted for *doc* targets only. |
| D3 | Data cutover | **One-time guarded script** (`scripts/convert-to-blocknote.ts`), run per surface prefix in quiet windows; manual re-creation is the accepted Plan B for stubborn docs. Old data left in place: new block content in a new Y fragment alongside legacy `"default"`; old fragments + version snapshots untouched until Phase 7 sign-off. | Kiran (2026-07-31): a registry job is overengineering at ~10 rich docs. The live-server clobber hazard (in-process Hocuspocus stores open docs every 2s, overwriting `CollabDocument.state`) is handled by two cheap guards — idle-check + post-write verify — instead of in-process machinery. See Cutover mechanics. |
| D4 | UI kit | **`@blocknote/shadcn`** (Tailwind-native; peer `tailwindcss ^4.1.12` — compatible with our 4.2), restyled to the DALI style guide via CSS vars + per-component overrides. **Gate at Phase 0:** fall back to `@blocknote/mantine` if shadcn flavor shows real gaps. | One styling system long-term; BlockNote UI components are individually replaceable React components, so flavor immaturity is patchable per-component. |
| D5 | Accepted losses | Float text-wrap images (`align` → block `textAlignment`, no wrap) and line spacing. Old CRDT history/snapshots become legacy-format (8,052 rows / 26 MB retained; legacy decoder archived for forensics). | Census: **zero docs use `lineHeight`** (line-spacing loss is free) and **zero anchored comments exist** (the entire anchor-remap workstream is deleted from scope — D2's store migration is 5 comment rows). |
| D6 | Yjs version | **Stay on yjs 13.x / y-prosemirror 1.x** (BlockNote core lists both as optional peers: `yjs ^13.6.27`, `y-prosemirror ^1.3.7` — matches our `13.6.30`/`1.3.7`). Do not opt into the `@y/*` v14 pre-release path. Pin exact BlockNote versions; upgrades are dedicated PRs. | BlockNote is mid-transition to Yjs v14; we take the stable line. Because these are *optional peer* deps, `yjs` and `y-prosemirror` **remain our direct dependencies permanently**. |

---

## Current state (verified 2026-07-31; corrected in v2)

### Infrastructure that survives untouched
- Hocuspocus server (`app/collab/server.ts`, port 3002, in-process via `app/entry.server.tsx`), auth (`app/collab/auth.ts`, `app/lib/collabAuth.ts`), Redis fan-out, advisory-lock snapshots, room naming (`app/collab/roomName.ts`), `CollabDocument`/`CollabDocumentVersion` (opaque `Bytes`), y-indexeddb offline, presence rooms, partner `readOnly` connection flag (`server.ts:97-99` — server-enforced, so BlockNote needing no read-only-collab concept client-side is acceptable; client additionally renders `editable:false`).
- The `sources.ts` registry *pattern* (seed/syncBack/authorize) — codecs swapped.
- S3 upload pipeline (`/api/upload/raw`, presign/url routes, `uploadEditorImage`). (Image **crop** is PR #1095, `feat/editor-image-crop`, **unmerged** — see Phase 1.)
- `DocComment` model + CommentsRail + notify() integration.

### Surfaces — live vs dormant (corrected against `app/lib/collabAuth.ts`)

**Live collab surfaces (~10 room prefixes):**

| Surface | Room / column | Rich content? |
|---|---|---|
| Pages (Notion replacement) | `doc:{pageId}:body`, `Page.contentDocId`; incl. project public-view writeups (`projects.$id.public-view.tsx:495`) and partner-visible pages (`PartnerDocumentView.tsx`) | YES — primary corpus |
| Mentor notes + templates | `mentorNote:{id}:body`, `mentorNoteTemplate:{id}:body`, sync-back to `contentJson` (registry: `app/collab/sources.ts`) | some |
| Epics | `Epic.descriptionDocId` (`EpicSprintManager.tsx`) | some |
| Education | `EducationOffering.descriptionDocId`, `EducationAssignment.instructionsDocId` | some |
| Partner SOW | `PartnerApplication.sowDocId` (`partnersow:{id}:body`) | some |
| Hiring (text-only sync-back) | `interview:{id}:notes`, `interview:{id}:recommendation`, `interview:{id}:rec-notes-{assignmentId}` (per-interviewer), `review:{id}:feedback`, `review:{id}:rejectionRationale`, `domainApplication:{id}:prepNote` | text-only |

**Dormant (schema columns only — no authorize branch, no client call site; they activate directly on BlockNote later):** `Sprint.goalDocId`, `Task.descriptionDocId`, `ProjectRoleRequest.notesDocId`, `ScheduledMeeting.descriptionDocId`, `User.bioDocId`, `EducationSession.materialsDocId`, `EducationSubmission.contentDocId`/`feedbackDocId`. `PageTemplate.contentDocId` is a seeded reference (template rooms are read as seed sources — verify no live room opens).

**Non-collab (PM JSON in `Json` columns):**
- `ChallengeVersion.description` **and PM JSON inside question arrays**: `Question.data.body` for `type:"info"` rows within `ChallengeVersion.questions` and `InternToFullFormVersion.questions`, rendered via `app/components/form-builder/info-body.tsx` → RichTextViewer. (Transcoded in Phase 5 — deleting the viewer without these breaks forms.)
- `PageDoc.body` + `PageDoc.sections`
- `SigningDocumentVersion.body` (2 rows), `SigningSignature.frozenBody` + `fieldValues` (52 archival rows — never transcoded, legacy-rendered)
- `MentorNote.contentJson` / `MentorNoteTemplate.contentJson` (sync-back mirrors)
- Partner: `PartnerApplicationDomain.expectedChallenges` + partner application rich fields (`partners.applications.$id.tsx`, `partner.apply.tsx`)

**Client editor layer replaced (~6,500 LOC):** `RichTextEditor.tsx` / `RichTextViewer.tsx` / `editor/RichEditor.tsx` / `CollaborativeEditor.tsx` (1,454) / `DocumentEditor.tsx` (435) / `editor/*` (presets, toolbar, BubbleToolbar, formatting-controls, slash-menu, mention, image, blocks, signing-fields, DocToc, PageCover, PageIconPicker) / `signing/components/SigningFillView.tsx`. Kept-but-rewired: `components/collab/*` (PresenceBar, PresenceProvider, CommentsRail, VersionHistoryPanel).

**Server/format-coupled consumers (complete list — each must move with its surface or in Phase 2):**
- `app/collab/`: `pm-to-y.ts`, `persistence.ts` (seed, plaintext extract + hiring sync-backs at `persistence.ts:192-225`, snapshots), `sources.ts`, `export.ts`, `export-html.ts`, `export-markdown.ts`, `export-pdf.ts`, `import-markdown.ts`, `mentions.server.ts`, `write.ts`
- `app/lib/signing-fields.ts` (`collectSigningFields`, `bakeSigningBody`)
- MCP: `app/mcp/tools/set-page-content.ts`, `read-page.ts`, **`create-page.ts` (also seeds markdown content)**
- **Public API / dali.website**: `app/public-api/lib/public-projects.server.ts` (`proseMirrorToBlocks(collabDocToProseMirror(...))` — note: its `pm-to-blocks.ts` converts to *website display blocks*, an unrelated "blocks" concept) and `public-offerings.server.ts` (plaintext). Post-conversion these decode the wrong fragment/shape — rewritten over BlockNote block JSON.
- **Education/portal server HTML renderers** (`collabDocToHtml` → `dangerouslySetInnerHTML`): `education/lib/lms.server.ts` (+ `readMaterialPage`), `education.$offeringId.tsx`, `portal.education.$offeringId.tsx`, `education.$offeringId.page.$pageId.tsx`, `CourseHub.tsx`
- Export route `app/routes/documents.$pageId.export.ts` (pdf/docx/md)
- Seeds: `prisma/seed.ts` writes PM JSON to `contentJson` columns and `contentDocId` *references* only — **no CollabDocument bytes are seeded today; those rooms start empty** (so seed changes = emit block JSON in columns; fragment-seeding machinery is new if we want seeded room content).

---

## Target architecture

### Client: one editor family, `app/components/doc/`
- **`<DocEditor>`** — single BlockNote-based editor. Props: `features` (capability config, successor of `EDITOR_PRESETS`), `collab` (`{provider, fragment, user}` | absent → local mode), `editable`, `onChange` (local mode emits block JSON), `density`.
  - Read view = `editable:false` — parity is structural; `RichTextViewer` concept retired (after Phase 5/7).
  - Collab: `withCollaboration` (from `@blocknote/core/yjs`, v0.52 API) with an explicitly named `Y.XmlFragment` — **verified: custom fragment names in an existing Y.Doc are supported**, which is what makes the dual-fragment cutover possible. HocuspocusProvider reuse (existing `getCollabUrl`, session-id token), y-indexeddb unchanged, cursors via `showCursorLabels`, undo via BlockNote's per-user Y.UndoManager (deletes the duck-typing hack).
- **Custom schema** (`app/components/doc/schema/`):
  - `mention` — `createReactInlineContentSpec`, async search on `/api/mentions/search`; attrs `{id, label}` preserved 1:1.
  - `callout` — **structural change, decided at Phase 0**: current callout is `content:"block+"` (multi-block container); BlockNote custom blocks take inline content only, with children rendered via generic nesting (indented below, not visually inside) and custom blocks can't nest custom blocks. Options: (a) callout as inline-content block + nested children styled to look contained (CSS on the nesting wrapper), or (b) flatten multi-block callouts to sequential callout-styled blocks at conversion. Phase 0 prototypes (a); mapper rule follows.
  - Headings: **h1–h6 map 1:1** (BlockNote supports levels 1–6 since v0.32; configure `levels`).
  - `signingField` family + `variable` — custom inline content (`content:"none"`), mode-aware renderers (author pill / fill input / view); fill values held in host React state keyed by `fieldId` (as today). Known upstream wart #2134 (custom blocks don't re-render on `isEditable` *transitions*) — Phase 0 tests transitions specifically, since author/fill/view mode-switching hits exactly this.
  - Image: native file block + `uploadFile` hook → S3; `previewWidth` resize; block `textAlignment`. Code blocks: **`@blocknote/code-block`** (Shiki — separate package, add to deps; watch bundle size).
- **Document chrome kept:** `DocumentEditor` shell (title/cover/icon/tags/TOC/presence/export) survives; body swaps. TOC/word-count walk block JSON.
- **Comments (D2):** ThreadStore over DocComment per the scoped contract above; CommentsRail stays the render surface for file/pagedoc targets and un-anchored doc threads.

### Server: codecs on block JSON
- **`@blocknote/server-util`** (`ServerBlockNoteEditor` — verified: supports custom schemas; `blocksToMarkdownLossy`, `tryParseMarkdownToBlocks`, `blocksToFullHTML`, `tryParseHTMLToBlocks`, `yXmlFragmentToBlocks`, `blocksToYXmlFragment`) replaces `import-markdown.ts` (delete mdast pipeline), `export-markdown.ts`, `export-html.ts`. **Phase 0 must validate server-util inside the react-router/Vite server bundle** (jsdom + React SSR of custom blocks; BlockNote documents bundling caveats for Next — find the RR7/Vite equivalent, likely `ssr.external`).
- `export-pdf.ts`: keep pdfkit, walker over block JSON. **No GPL/AGPL xl packages** (`xl-pdf-exporter` is AGPL-3.0 OR PROPRIETARY).
- `persistence.ts`: plaintext extraction + hiring sync-backs read the `"blocknote"` fragment when present; **during the rollout window both fragments are consulted** — if the legacy fragment changed after conversion (drift, see below), flag rather than silently ignore.
- `sources.ts`: codecs become blocks↔fragment; mirror columns store block JSON (renderers updated in the same surface PR).
- `mentions.server.ts`: scan block JSON.
- MCP: `set_page_content`/`create-page` = markdown → blocks → fragment replace; `read_page` = fragment → blocks → markdown. **Write side branches on fragment presence per doc** (a converted doc must never receive new `"default"` writes from MCP). Fixture-test `tryParseMarkdownToBlocks` against real MCP/Notion-sync markdown (PR #953 pipelines) — known upstream defects (e.g. blockquotes #1762).
- Signing server: `collectSigningFields`/`bakeSigningBody` walk block JSON; `frozenBody` becomes baked block JSON.
- Public API + education/portal HTML renderers: rewritten over block JSON (enumerated above).

---

## Cutover mechanics (v2.1 — one-time guarded script)

**Census first (already written):** `dali-api/scripts/blocknote-census.sql` — read-only, runnable today against prod. Replaces the "~10 rich docs / zero signatures" assumptions with data (per-prefix inventory, rich-node heuristic per doc, signing counts, node-type histogram across all PM-JSON columns, comment/anchor counts, page visibility, info-question bodies). Review output before Phase 2 sign-off; the node-type histogram *is* the mapper's required coverage list.

**Mechanism: `dali-api/scripts/convert-to-blocknote.ts`** — one-time, idempotent, run per surface prefix during a quiet window (~120 users, summer lull). The live-server hazard (in-process Hocuspocus stores open docs every 2s, overwriting `CollabDocument.state` — an out-of-process writer can be clobbered) is handled by two cheap guards rather than in-process machinery:
1. **Idle check** — skip any doc with `updatedAt` in the last 10 minutes; report "active — rerun later".
2. **Post-write verify** — re-read `updatedAt` after writing; if it moved, a live session stored concurrently → reconvert that doc (or just rerun; the script is rerun-safe).

Per-doc: decode `"default"` (legacy y-prosemirror + frozen PM schema, `app/collab/legacy/`) → map via `pm-to-blocknote.ts` (named to avoid confusion with public-api's unrelated `pm-to-blocks.ts`) → `blocksToYXmlFragment` into `"blocknote"` → write merged state. Idempotency = a **conversion marker in the Y.Doc** (`Y.Map("meta")`: legacy state-vector hash + timestamp) — reruns skip converted docs unless the legacy fragment changed since (then re-merge + report). Per-doc **loss report** (unknown node → paragraph+text, logged) + automated plaintext before/after diff.

**Stale-writer risk** (a tab open across the surface deploy, or an offline y-indexeddb replica, writing `"default"` after conversion): **accepted residual risk at this scale**, mitigated by quiet-window runs + the marker-hash drift check on rerun/next-day. Escalation held in reserve, built only if drift is actually observed: a ~10-line `collabSchema` connect-param gate in `server.ts` rejecting legacy clients on converted docs.

**Choreography per surface (Phase 3/5 discipline):** ship the surface PR (new editor + read paths + write-side branch) → run the script for that prefix in a quiet window → next-day drift check → next surface. Staging is rebuilt from the prod snapshot each deploy — rerun the script there when testing conversion-dependent behavior (one command); dev seeds emit block JSON natively so dev never needs it. **Manual re-creation is the accepted Plan B:** at ~10 rich docs, copy-pasting a stubborn doc into the new editor is legitimate — don't gold-plate the mapper for one weird document.

**Rollback:** before a surface's first real BlockNote edit, rollback = revert PR (legacy fragment untouched). **After real edits, rollback discards them** (no blocks→PM reverse mapper) — the point of no return is per-surface, at first post-cutover edit. State this in each surface PR.

**Non-collab columns** (Phase 5/6): same script, second mode — plain row updates guarded by a format sniff (`{type:"doc"}` = legacy PM vs block array = converted); no live-writer hazard. Comment-anchor remap (D5) runs at pages-surface conversion time.

---

## Census results (prod, 2026-07-31 — queries 1–2; signing/histogram/comments pending)

- **Only 5 room prefixes exist**: `doc` (142, 960 kB, 139 edited last 30d), `interview` (131, cold since Jun 7), `review` (50, cold), `epic` (22 docs, **401 bytes total = empty**), `domainApplication` (1, 2 bytes). **`mentorNote`, `mentorNoteTemplate`, `eduoffering`, `eduassignment`, `partner-sow` have ZERO rooms** (lazy seeding, never opened) → those surfaces need **no Yjs conversion at all**; their rooms are born BlockNote-native (seed codecs read the transcoded source columns).
- **Real conversion workload = pages + cold hiring rooms only.** Hiring rooms have zero stale-writer risk (untouched since June) but must convert **before the fall cycle creates new rooms**.
- **~80 docs flag rich content, but the bulk is a Notion-sync import burst** (sequential cuids, 03:15–03:23 on 2026-07-30, ~1.6–2.7 kB, one image each — PR #953 pipeline). Option for those: **re-run the import through the new pipeline** (`set_page_content` → blocks natively) instead of converting — zero mapper risk. Kiran confirms many are empty/sparse.
- **Mapper priority from real data**: image, mention, marks (highlight), toggle (**3 docs** — incl. the one 261 kB doc, the single careful-eyeball target), table (**1 doc**). **Zero** callout/taskList/codeBlock in collab docs; **zero `lineHeight`** → the D5 line-spacing loss costs nothing.
- Heuristic caveat pending disambiguation queries: `mention`/`highlight`/`img` flags on interview notes may be prose substrings ("mentioned", "highlights") — verify via `notifiedMentionUserIds` cardinality (real mention nodes) and `/api/upload` presence (real image nodes).
- Phase 3 ordering implication: pages first (as planned), hiring rooms second (cold, bulk, mechanical), everything else is an editor swap with no conversion step.

**Round 2 (queries 3, 5–8, A–C):**
- **Signing: 52 signatures exist** (2 docs / 2 versions / 2 bindings) — migrated confidentiality archives, not new usage. D1 updated: frozen archives are never transcoded; legacy render path retained (Phase 6/7). Verify `frozenBody` fill: `SELECT count(*), count("frozenBody") FROM "SigningSignature";`
- **Comments: 5 total (3 doc / 2 file), zero anchored, zero resolved** — anchor remap deleted from scope; ThreadStore data migration is trivial.
- **Pages: 187 total, 57 publicVisible** — the dali.website blast radius is real, but ~45 of the rich docs are auto-generated **"Project showcase"** pages from the 07-30 import burst (query C) → the **re-import path covers most of the public corpus**; the public-api renderer rewrite (Phase 2) is what protects the rest.
- **Organic rich docs ≈ 16** (Interview Guide 261 kB w/ toggle, handoff docs, meeting notes, "Project Name Brainstorm" = the one table doc, "Waiver PDF experiments" = toggle) — Kiran's "~10" intuition was right once the burst is separated.
- **Hiring rooms confirmed text-only**: all 5 interview + 1 review image flags have no `/api/upload` URL → prose false positives ("image" as a word). Real image docs: 54, all under `doc:`.
- **Real mention nodes: 1–2 docs** (only `doc:cmrs9dckv…` has notification evidence; the 40 kB flag is prose "mentioned").
- Version history going legacy-format: 8,052 snapshots / 26 MB / 346 docs — retained, forensic-only after Phase 7.
**Round 3 (query 4 histogram) — census COMPLETE:**
- JSON-column corpus is even simpler than the collab one: `ChallengeVersion.description` = one-paragraph-with-links docs (54 docs, 55 links, 2 bolds); mentor notes/template = bare paragraphs + hardBreaks; `PageDoc` = paragraphs/headings/lists/13 images/marks; signing bodies = lists/headings/marks + `checkboxField`×10, `dateField`, `signatureField`, `variable`, 1 image (**no `initialField`/`textField` appear in data**).
- **Nothing in any JSON column uses tables, task lists, callouts, toggles, code blocks, blockquotes, or mentions.**
- **Total required mapper coverage (both corpora, from prod data):** paragraph, heading, bullet/ordered list + listItem, `hardBreak` (→ soft break vs block split — decide in Phase 2), image, toggle (3 collab docs), table (1 collab doc), marks bold/italic/underline/link/highlight, mention (1–2 docs), signing-field family (Phase 6). Everything else routes to the safe fallback (paragraph + extracted text + log) and should never fire.
- One oddity: a single empty-string `type` value inside `PageDoc.sections` — likely section metadata, not a PM node; check during Phase 5.

## Phases

**STRATEGY CHANGE (2026-07-31, Kiran, post-spike): phases 1–7 are being built as ONE consolidated PR** on branch `feat/blocknote-migration` (worktree `.claude/worktrees/blocknote-migration`), parallel implementation agents with disjoint file ownership + a shared schema-config contract (`app/components/doc/schema/configs.ts`), followed by consolidated verification. Two design changes enable the single PR:
1. **Lazy convert-on-load replaces deploy choreography**: the Hocuspocus `onLoadDocument` path converts `"default"`→`"blocknote"` in-process when the new fragment is empty and the legacy one isn't; server READ paths (HTML render, exports, MCP) use the same rule in-memory (`readDocAsBlocks`) without writing. No empty-doc window, no per-surface script runs; the batch script becomes a post-deploy sweep/warmer. Non-collab JSON columns: format-sniff (`{type:"doc"}` vs block array) + convert-on-read via the pure mapper; write-back on next edit.
2. **Legacy deletion ships in the same PR** (no call sites remain), except `app/collab/legacy/` (mapper + decode + `render-frozen` for signature archives).
The phase list below remains the logical decomposition/verification checklist for the consolidated build.

Branching: `feat/blocknote-*` off `origin/staging` (origin/HEAD is stale dev). PRs → staging; every PR flags collab impact (CLAUDE.md). No Prisma schema migrations anywhere in this plan. A surface + all its read paths + its write-side branch move atomically per PR (the #1091 discipline). Fast-merge culture: check PR state before follow-up pushes.

### Phase 0 — Spike (2–3 days) `feat/blocknote-spike` — throwaway
1. `<DocEditor>` on pages against live Hocuspocus, `"blocknote"` fragment in an existing doc, two browsers: sync, cursors, offline (y-indexeddb), undo.
2. shadcn flavor under Tailwind 4.2 + dark mode + DALI palette (**D4 gate**).
3. Mention inline-content spec with async search.
4. `ServerBlockNoteEditor` (custom schema) **inside the RR7/Vite server bundle** — markdown+HTML round-trips both directions.
5. Signing feasibility: interactive custom inline content across `isEditable` **transitions** (#2134 exposure) (**D1 gate input**).
6. Callout prototype: inline-content block + styled nesting (**mapper rule decided**).
Exit: all six demonstrated or documented fallback triggered.

**PHASE 0 RESULTS (2026-07-31, worktree `.claude/worktrees/blocknote-spike`, commits 755fca60 + cbfea698; 6 parallel build agents + browser-verification pass; ~40 screenshots in `spike-artifacts/`):**
1. **Collab: PASS (headline result).** BlockNote bound to a `"blocknote"` fragment on a live Hocuspocus room, in-browser: bidirectional sync (~1.5s), legacy `"default"` fragment **byte-frozen while typing** (evidence panel + `/documents/:id` untouched), `CollabDocument` round-trip through store/reload (91→648 bytes, both fragments intact), offline→reconnect replay. API gotchas: the `collaboration` editor option is REMOVED in 0.52 — use `withCollaboration()` from the `@blocknote/core/yjs` subpath; `provider.awareness ?? undefined` shim needed; the StrictMode doc cache from CollaborativeEditor is still required; `showCursorLabels:"always"` is broken upstream (label CSS needs `data-active` that "always" never sets) → use `"activity"`; awareness colors must be 6-digit hex (y-prosemirror rejects hsl). **Collab undo: RESOLVED (commit c6ba8d04)** — root cause was NOT dual yjs instances (red herring): y-prosemirror's `yUndoPlugin` creates its `UndoManager` in plugin-STATE init but destroys it in the plugin-VIEW's `destroy()`, while BlockNote/tiptap v3 preserve EditorState across `unmount()`/`mount()` — so StrictMode's simulated remount (and, in production, **every `editable` prop change**, which matters for signing mode flips) permanently kills undo. Fix carried into the production wrapper (Phase 1): a one-line effect neutering `undoManager.destroy` via `yUndoPluginKey` until the Y.Doc's real disposal. Verified in-browser: Mod-Z undoes only local edits, peer text survives, redo restores, cursor label on activity, zero console noise. Upstream-bug-worthy against both y-prosemirror and BlockNote. Dev config recipe still worth carrying: `resolve.dedupe: ["yjs","y-prosemirror","y-protocols"]` + `optimizeDeps.include` for @blocknote subpaths (first-load Vite re-optimization noise).
2. **D4 GATE: shadcn CONFIRMED.** Critical discovery: `@blocknote/shadcn` ships ZERO compiled UI styles — its chrome is Tailwind classes the consumer build must generate. Mandatory recipe (written + browser-verified in the real Vite pipeline, light+dark): a CSS file with `@reference` app.css + `@source` scan of `node_modules/@blocknote/shadcn/dist` + utilities import. Theming via `--bn-*` CSS vars on `.bn-root` (+ dark selector) pointed at app tokens — DALI palette confirmed in both modes; pass `theme={isDark?"dark":"light"}` strings (the mantine theme-object path follows SYSTEM dark, not `html.dark`). Mantine fallback also works (no leftover blue) but adds ~52KB + a second design system.
3. **Mention: PASS.** `createReactInlineContentSpec` + `SuggestionMenuController` — ~150 lines of TipTap suggestion plumbing collapse to ~15; `{id,label}` preserved 1:1 (`attrs`→`props`, same keys); one spec serves edit + read-only (no editor/viewer split). Async search, keyboard nav, chip insertion all browser-verified.
4. **server-util: PASS with ZERO config changes** in the RR7/Vite server bundle (proved by invoking the loader from the built `build/server/index.js` AND under dev). Recipe: none needed (Vite SSR externalization handles jsdom); **use non-React core specs server-side** (shared config object with the client React spec) — bare React specs crash dev-React on async teardown (`window.event`), `withReactContext` is the proven alternative. Markdown round-trip near-lossless (bullet marker + table padding rewrites only). **Y fragment round-trip EXACT including block IDs — the conversion-script primitive is validated.**
5. **D1 GATE: signing CONFIRMED, no workaround required.** Source + browser: inline-content renderers mount as portals INSIDE the React tree, so context-driven mode propagates — across fill↔view (both `editable:false`, the critical editable-invariant transition) every field re-rendered with correct mode, render counts proving in-place re-render, not remount. #2134 is a custom-BLOCK/`renderToDOMSpec` pathology, not live inline content. Interactive inputs/checkboxes work at `editable:false` (Tiptap `stopEvent` passes INPUT/BUTTON events through unconditionally). `key={mode}` remount fallback exists and preserves the document (author edits survive).
6. **Callout: verdict (a) styled nesting CONFIRMED** in-browser — continuous colored box around nested children (BlockNote's own toggle-block house pattern + `:has()` on effectively-public `.bn-*`/`data-*` selectors), emoji-cycling tints, acceptable Notion-style Enter/Tab semantics (Enter exits, Tab nests back in, Shift+Enter soft-breaks). **Mapper rule locked:** first paragraph → callout inline content, remaining blocks → children; non-paragraph first child → empty inline content. Minor fix needed: slash-item group key duplication (console error).

Extra findings: `Page.contentDocId` is vestigial — the real documents editor ALWAYS uses `doc:{pageId}:body` and nothing else reads the column (0 prod rows use it); conversion keys on room names. First-ever load of a BlockNote route triggers Vite dep re-optimization (transient dual-yjs warnings) — the optimizeDeps recipe above belongs in Phase 1.

### Phase 1 — Core editor package (≈1 week) `feat/blocknote-core`
`app/components/doc/`: DocEditor, feature config, theme, mention spec, callout block, upload hook, toolbar/side-menu/slash-menu trimmed to our command set, density modes, `@blocknote/code-block`. Unit tests + internal test route. Crop: if PR #1095 merges first, re-attach `ImageCropModal` + proxy to the block image toolbar; otherwise land crop against the BlockNote image block later (don't merge #1095 into a doomed stack).

### Phase 2 — Server codecs + conversion script (≈1 week, parallel with 1) `feat/blocknote-server`
`server-util` integration; new export/import/plaintext/mention codecs branching on fragment presence (branch-point dies in Phase 7); `app/collab/legacy/` (frozen PM schema + decoder) + `pm-to-blocknote.ts` mapper; conversion script (`scripts/convert-to-blocknote.ts`: guards, marker, loss reports, column mode). **Public-api + education/portal renderer rewrites** land here as codecs (activated per-surface). Round-trip fixture tests for every node type + real markdown corpus. **Census SQL runs against prod up front — review with Kiran before Phase 3; the node-type histogram defines mapper coverage.**

### Phase 3 — Collab surface rollout (≈1.5 weeks) `feat/blocknote-pages`, then batched surface PRs
Order: **Pages first** (largest corpus; includes DocumentEditor chrome rewire, PresenceBar/VersionHistoryPanel/DocToc, public-view writeups, partner document view, page-doc-linked education page routes, comment-anchor remap), then mentor notes+templates (registry codec swap), epics, education offering/assignments (+ their portal HTML renderers in the same PR), partner SOW, hiring text-only rooms (trivial). Per surface: PR → script run for its prefix (quiet window) → next-day drift check → next. Version *restore* targets `"blocknote"` (old snapshots restorable via legacy decode until Phase 7, then forensic-only).

### Phase 4 — Comments (≈1 week) `feat/blocknote-comments`
ThreadStore over DocComment (client cache + subscribe over existing channel; body text mapping; reactions omitted), comment marks in doc content, CommentsRail rewire (doc targets), notify() regression, delete decoration/anchor plumbing for doc targets. File/pagedoc rails untouched.

### Phase 5 — Non-collab fields (≈4–5 days) `feat/blocknote-fields`
FormBuilder intro, challenge descriptions **and `Question.data.body` info-bodies (`info-body.tsx`) in `ChallengeVersion.questions` + `InternToFullFormVersion.questions`** with all ~10 viewers (`ApplicationViewer`, `ChallengePreview`, `ChallengeDetail`, `MemberFormFillView`, `FormDetail`, portal routes, `domain-lead.tsx`), PageDoc guides (multi-section), partner application fields + `expectedChallenges` + `partner.apply.tsx`, intern-to-full. Column transcode ships in the same PR as each surface's render swap.

### Phase 6 — Signing port (≈1 week) `feat/blocknote-signing` — **gated**
Pre-flight: issuance job paused; check `frozenBody` fill count. Field/variable specs + author insert controls, `SigningDocumentDetail`/`SigningFillView`/`sign.$bindingId` swap, `collectSigningFields`/`bakeSigningBody`/PDF walker over block JSON, transcode the 2 `SigningDocumentVersion.body` rows, re-verify issuance + hard gate end-to-end, unpause. **Archive strategy: the 52 pre-migration `frozenBody` rows are never transcoded** — the archive view (`admin-console.agreements.$id.signature.$sigId.tsx`) renders them server-side via the retained legacy walker; new signatures freeze block JSON. **Gate:** if fill-mode regressed vs Phase 0, invoke the carve-out fallback (signing keeps a frozen minimal TipTap island) — do not block fall on this vertical.

### Phase 7 — Cutover close-out + deletion (≈3 days) `feat/blocknote-cutover`
Final script pass sweeps stragglers; census + drift clean on prod; loss reports reviewed with Kiran. Then delete: legacy editor components, `editor/*` TipTap extensions/toolbars, legacy codecs + format branch-points, 16 direct `@tiptap/*` deps, mdast/micromark. **One permanent legacy resident:** a pure PM-JSON→HTML walker (extracted from `export-html.ts` — it has no TipTap dependency) stays as `app/collab/legacy/render-frozen.ts` to render the 52 pre-migration signature archives forever; everything else in `app/collab/legacy/` + the conversion script archive under `scripts/` for snapshot forensics.

### Phase 8 — Hardening (≈1 week, overlaps 5–7)
Unit + Playwright E2E (add: two-context collab on pages; signing author→issue→fill→archive; mention + comment notifications), per-surface manual checklist (edit/save/reload/export/read-as-other-role), PageSpeed CI comparison (route-level lazy `DocEditor` import; Shiki weight), **desktop WKWebView smoke** (Tauri shell renders this editor in Safari's engine — drag handles/menus), mobile-web smoke (known BlockNote weak spot — document workarounds), export fidelity eyeball on all rich docs from the census.

**Timeline: ~6–7 weeks with 1∥2 and 5/6/8 overlap → lands ~mid-September. Tight against fall. Go/no-go checkpoint after Phase 3 (≈4 weeks in): if slipping, reduced-scope fall fallback = Pages + mentor notes + hiring rooms on BlockNote (the daily-use surfaces), Phases 5–6 complete during early fall behind the same per-surface mechanism.**

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Live server clobbers conversion writes | Script guards: idle-check (skip docs edited < 10 min ago) + post-write `updatedAt` verify; quiet-window runs; marker-based rerun safety. |
| Stale clients / offline replicas write legacy fragment post-conversion | Accepted residual risk at ~120 users/summer lull: quiet-window runs + marker-hash drift detection on rerun/next-day check. Escalation in reserve (build only if drift observed): ~10-line `collabSchema` connect gate. |
| Staging rebuilt from prod snapshot each deploy erases conversions | Rerun the script on staging when testing conversion-dependent behavior (one command); dev seeds emit block JSON natively. |
| Pre-1.0 breaking changes / Yjs v14 churn | Pin exact versions; upgrades are dedicated PRs; D6 stays on yjs 13 line (kept as our direct deps — optional peers). |
| shadcn flavor immaturity | Phase 0 gate → Mantine fallback; per-component override escape hatch. |
| Conversion fidelity | Total mapper + per-doc loss report + automated plaintext diff; legacy fragments untouched until Phase 7; census-driven verification; OpenProject-style "freeze legacy doc read-only" is the fallback if a doc won't convert cleanly. |
| Signing fill-mode interactivity (#2134 is an isEditable-transition re-render bug) | Phase 0 tests transitions; values in host state; Phase 6 gate + carve-out fallback; issuance paused through Phase 6. |
| Callout block-model mismatch (`block+` container → inline+children) | Phase 0 prototype decides representation; explicit mapper rule; flatten fallback. |
| server-util/jsdom in the RR7/Vite server bundle | Phase 0 item 4; `ssr.external`/equivalent documented before Phase 2. |
| Markdown import defects (MCP/Notion-sync writers) | Fixture corpus from real pipelines; known-issue list pinned per BlockNote version. |
| Bundle size (Shiki, editor) | Route-level lazy import; PageSpeed CI baseline comparison; trim command set. |
| Rollback after real edits discards them | Point of no return stated per surface PR; go/no-go after Phase 3 limits exposure. |
| Timeline compression before fall | Explicit reduced-scope fallback (above); phases 5–6 can land early-fall safely because the per-surface mechanism doesn't require a big bang. |

## Explicitly out of scope
- `xl-*` packages (GPL/AGPL — never add without a licensing decision), multi-column, AI blocks.
- Per-block MCP tools (`update_block`) — follow-up unlocked by this work.
- Dormant surfaces (listed above) — they activate on BlockNote later.
- Any Prisma schema migration.

## Dependency changes
Add (pinned exact): `@blocknote/core`, `@blocknote/react`, `@blocknote/shadcn` (or `/mantine` per Phase 0), `@blocknote/server-util`, `@blocknote/code-block`.
Remove at Phase 7: all 16 direct `@tiptap/*` deps, `mdast-util-*`/`micromark-*`.
Keep permanently: `yjs`, `y-prosemirror` (BlockNote optional peers — we must provide them), `@hocuspocus/*`, `y-indexeddb`, `pdfkit`, `html-to-docx`, `isomorphic-dompurify`.
