# Collaborative Whiteboard — Spec

**Status:** Proposed (feasibility complete, not built) · **Date:** 2026-09-20 · **Flag:** `whiteboard` (off)
**Worktree:** `feat/whiteboard` (branch `worktree-feat+whiteboard`, based on `origin/staging`)

## Goal

Add a FigJam / Zoom-Whiteboard–style collaborative canvas to DALI OS: an infinite,
multiplayer whiteboard with sticky notes, shapes, connectors, freehand pen, text,
and images, with live cursors. It lives in Drive as a first-class document type,
shares like any Page, and rides the existing Yjs + Hocuspocus realtime stack.

**Decisions locked (2026-09-20):**
- **Rendering engine:** **Excalidraw** (`@excalidraw/excalidraw`, MIT). We own the
  Yjs binding (Excalidraw ships no first-party Yjs sync; the community `y-excalidraw`
  binding is dormant/immature, so it is a reference, not a dependency).
- **Surface model:** a new **`Whiteboard` value on the `Page.kind` enum**, created and
  browsed from Drive like a document — *not* a hardcoded singleton route.
- **`@dnd-kit` is NOT the canvas primitive.** It is a DOM droppable-container toolkit
  (used by Kanban/Drive/tabs) and cannot do pan/zoom transforms, geometric hit-testing,
  culling, or freehand smoothing. Excalidraw owns the canvas; `@dnd-kit` is irrelevant here.

## Why this is cheap on the backend

The realtime stack is deliberately content-agnostic, so a non-text canvas reuses it
almost entirely. Verified against the code:

- **Persistence is generic.** `storeDocument()` (`app/collab/persistence.ts:276`) does
  `Y.encodeStateAsUpdate(doc)` and upserts the raw bytes into `CollabDocument.state`
  *before* any entity-specific sync. It does not care whether the Y.Doc holds a BlockNote
  `XmlFragment` or a `Y.Map` of shapes. An unregistered entity (`whiteboard:*`) hits the
  generic upsert and then no-ops every entity-specific `if` block — **shapes persist with
  zero new columns and zero schema change to the collab tables.**
- **Version history is free.** `CollabDocumentVersion` snapshots the Y.Doc state on a
  throttle (~30s while active). Whiteboards get version history/restore automatically.
- **The non-text pattern already exists.** `form:*` and `rubric:*` rooms are `structured:
  true` in `app/collab/sources.ts` — they store `Y.Array`/`Y.Map` and use the
  `useSharedArray`/`useSharedMap` hooks. A shape store is the same shape of thing.
- **Read-only live viewers are a solved case.** `authorizeCollabDoc` (`app/lib/collabAuth.ts:56`)
  returns `{ allowed, readOnly }`; the `doc:` branch (line 135) delegates to `getPageAccess`
  and returns `readOnly: !canEdit` — viewers connect live but their writes are dropped. The
  whiteboard branch copies this exactly (unlike `form`/`rubric`, which are edit-only).
- **Presence/cursors already flow.** `provider.awareness` broadcasts peer state
  (`PresenceProvider.tsx`); we feed it Excalidraw pointer positions.
- **Auth, session tokens, offline (IndexedDB), sync indicator** — reused unchanged.

## Data model

### Page kind
Add `Whiteboard` to the `PageKind` enum (`prisma/schema.prisma:4638`):
```prisma
enum PageKind {
  FreeForm
  Structured
  Folder
  Whiteboard   // new — canvas document, body lives in a whiteboard:* collab room
}
```
A whiteboard Page reuses all existing Page columns: `title`, `iconEmoji`,
`workspaceType`/`workspaceId`, `folderPageId` (Drive placement), `scopeKind`/shares,
`archivedAt`, `partnerVisible`, etc. `contentDocId` stays `null` — the room name is
derived deterministically from the Page id (below). **This is the only Prisma migration**
(an enum-value add — non-destructive, no data loss).

### Collab room
New room name, alongside the others in `app/collab/roomName.ts`:
```ts
// whiteboard:{pageId}:canvas — Excalidraw scene, structured Y.Map (not a fragment).
export function whiteboardRoomName(pageId: string): string {
  return `whiteboard:${pageId}:canvas`;
}
```
Room parses as `entity="whiteboard"`, `id=pageId`, `field="canvas"` (3 parts, as
`authorizeCollabDoc`/`parseDocName` require).

### Y.Doc shape store
- `ydoc.getMap("elements")` — a `Y.Map` **keyed by Excalidraw element id**, value = the
  serialized `ExcalidrawElement`. Element-id keying gives natural add/update/delete
  granularity. Excalidraw's own `version`/`versionNonce`/`updated` fields drive
  conflict resolution via its `reconcileElements` helper, so we do **not** need per-property
  nested `Y.Map`s (last-writer-by-version — Excalidraw's native semantics).
- `ydoc.getMap("files")` — image/asset references. **Do not store base64 image dataURLs in
  the CRDT** (bloats every peer's state and every snapshot). Upload images to S3 via the
  existing Drive presigned-URL path and store only `{ fileId → { s3Key, mimeType } }` here.
  (v1 may inline tiny images to ship faster; S3 offload is Phase 2.)
- **Yjs gotcha:** never mutate an object after putting it into / reading it from a shared
  type — Yjs does not clone it and peers silently desync. Always write fresh element objects.

`plainText` mirror: teach `isStructuredRoom` (`app/collab/sources.ts:211`) that
`whiteboard` is structured so `storeDocument` uses `getStructuredPlainText` (JSON) instead
of `getPlainText` (which returns `""` for non-fragment docs). One line:
`return COLLAB_SOURCES[entity]?.structured === true || entity === "whiteboard";`

## Backend changes (the entire net-new server surface)

1. **`app/collab/roomName.ts`** — add `whiteboardRoomName()` (above).
2. **`app/lib/collabAuth.ts`** — add an explicit `whiteboard` branch, a copy of the `doc:`
   branch (load the Page, delegate to `getPageAccess`, return `readOnly: !canEdit` for
   viewers). This must precede the `COLLAB_SOURCES` fallback so read-only is expressible:
   ```ts
   if (entity === "whiteboard") {
     const page = await prisma.page.findUnique({ where: { id }, select: { /* same select as doc: */ } });
     if (!page || page.archivedAt !== null) return deny;
     const access = await getPageAccess(userSub, page);
     if (access.canView) return { allowed: true, readOnly: !access.canEdit };
     return deny;
   }
   ```
3. **`app/collab/sources.ts`** — extend `isStructuredRoom` to include `whiteboard` (above).
   No `COLLAB_SOURCES` entry is required (auth is handled by the explicit branch and the
   Y.Doc is self-sourcing); the generic upsert persists the scene, and `loadDocument`
   seeding is a harmless no-op for an empty new room.
4. **Prisma migration** — add the `Whiteboard` enum value (new migration file; never hand-edit).

That's it — no new tables, no changes to the Hocuspocus server, no changes to existing docs.

## Frontend

### WhiteboardEditor component (`app/components/whiteboard/`)
Mirror the `DocEditor.tsx` SSR-safe lazy pattern (Excalidraw touches `window`, must not SSR):
```tsx
const WhiteboardImpl = lazy(() => import("./WhiteboardImpl"));   // pulls in @excalidraw/excalidraw
export function WhiteboardEditor(props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <WhiteboardFallback />;
  return <Suspense fallback={<WhiteboardFallback />}><WhiteboardImpl {...props} /></Suspense>;
}
```
`WhiteboardImpl` acquires the Y.Doc + `HocuspocusProvider` (reuse the refcounted
`acquireCollabDoc` cache in `app/components/doc/collab-doc.ts`, or a whiteboard-scoped
twin), mounts `<Excalidraw>`, and runs the binding.

### The Yjs ↔ Excalidraw binding (the real work we signed up for)
- **Local → Yjs:** Excalidraw `onChange(elements, appState, files)` → diff vs. last-known →
  in `ydoc.transact(fn, WHITEBOARD_LOCAL_ORIGIN)` write changed/added elements into
  `elements` map, delete removed ids.
- **Yjs → local:** `elementsMap.observeDeep((events, txn) => { if (txn.origin === WHITEBOARD_LOCAL_ORIGIN) return; ... })`
  → build next array → `reconcileElements(current, incoming, appState)` →
  `excalidrawAPI.updateScene({ elements })`. Guard the echo loop with the transaction origin.
- **Cursors/presence:** on pointer move, `awareness.setLocalStateField("pointer", {x, y, tool})`;
  observe awareness → map peer states into Excalidraw `updateScene({ collaborators })`
  (Excalidraw renders remote cursors natively). Ephemeral — never written to the doc.
- **Undo/redo wrinkle:** Excalidraw has its own local undo stack; it is not Yjs-aware.
  Keep local undo scoped to local-origin changes (do not undo remote peers' edits). Validate
  behavior; if needed, gate undo through the origin-tagged transaction path. **Call this out
  as the top integration risk.**
- **Read-only:** when the loader says `!canEdit`, pass Excalidraw `viewModeEnabled` and connect
  the provider read-only (the server already drops writes via `readOnly`).

### Route
Under the main layout in `app/routes.ts`:
```ts
route("whiteboard/:pageId", "routes/whiteboard.$pageId.tsx"),
```
Loader: load Page, `getPageAccess`, gate on the `whiteboard` flag (redirect if off), issue
`collabToken` (session id via `parseSessionCookie`) + `userName`/`userId`, return `canEdit`.
Render `<WhiteboardEditor collab={{ documentName: whiteboardRoomName(pageId), token, userName, userId }} editable={canEdit} />`.

### Drive integration
- **Create:** add "Whiteboard" to the Drive "New" menu next to Document/Folder →
  create a Page with `kind=Whiteboard` in the target folder → redirect to `/whiteboard/:pageId`.
- **Icon:** map `kind=Whiteboard` to a Lucide icon (`PenTool` or `Shapes`) in the Drive
  browser and `file-icon.ts` category logic.
- **Listing/filter:** whiteboards appear in the Drive tree like documents; fold into the
  "documents" type filter (or add a "whiteboards" filter).
- **Quick-look (future):** the planned Tier-2 viewer registry
  (`specs/file-type-preview-consolidation.md`) can get a `WhiteboardViewer` (read-only
  Excalidraw at `viewModeEnabled`) for previews. Not required for v1.

### Feature flag, nav, Command-K
- Add `whiteboard` to `FEATURE_FLAGS` (`app/lib/feature-flags.ts`), `defaultEnabled` off.
  Gate: the Drive "New → Whiteboard" action (client `useFeatureFlag`), the route loader
  (server `isFeatureEnabled`), and any nav/Command-K entry.
- **Nav:** whiteboards live in Drive, so no new top-level area is needed. Add a Command-K
  "New whiteboard" command (mirrors "New document"). Optionally a Drive subtab filter.

### Design / theming (fit the app)
- **Aesthetic caveat:** Excalidraw's hand-drawn look is its signature and only partially
  themeable — it will not perfectly match DALI's UI. Accepted as part of the engine choice.
- Sync Excalidraw `theme` to the app's light/dark; override its CSS custom properties toward
  brand tokens where possible; trim its chrome via `UIOptions`/`renderTopRightUI` to reduce
  visual clash.
- **Tab-iframe:** the canvas is pointer/wheel heavy but works within its iframe bounds. Portal
  any DALI overlays (share dialog, menus) to the shell via `useOsShellRoot()` so they read the
  correct palette; the tab-drag `PaneBodyDropZones` overlay only intercepts pointer events
  *during* a tab drag, so it won't fight normal canvas interaction.
- **Bundle:** `@excalidraw/excalidraw` is large — lazy-load only on the whiteboard route
  (the pattern above). Configure `window.EXCALIDRAW_ASSET_PATH` / bundler asset handling for
  its fonts, and import its CSS.

## v1 feature scope
Infinite canvas, pan/zoom, shapes, arrows/connectors (with binding), freehand pen, text,
sticky-note-style elements, images, multiplayer + live cursors, per-user local undo, version
history (free via snapshots), read-only viewers, Drive create/share/rename/archive.

**Deferred (build-on-top-of-Excalidraw or later phases):** dedicated sticky-note primitive,
frames/sections, whiteboard-anchored comments (Excalidraw OSS has none; DALI's `DocComment`
could anchor to canvas coords later), templates, export-to-image beyond Excalidraw's built-in.

## Phasing
- **Phase 1 — Multiplayer MVP:** flag + `PageKind` migration + Drive create + route +
  lazy Excalidraw + Yjs binding (elements add/update/delete) + persistence. Ships a real,
  collaborative, persisted whiteboard.
- **Phase 2 — Presence & assets:** live cursors via awareness; image upload → S3 (no base64
  in CRDT); reconciliation hardening; read-only viewer polish.
- **Phase 3 — Drive parity & history:** version-history UI/restore; quick-look `WhiteboardViewer`
  in the viewer registry; icon/filter polish; Command-K.
- **Phase 4 — FigJam extras:** sticky-note primitive, frames, whiteboard comments (as scoped).

## Risks / flags
- **Owning the Yjs↔Excalidraw binding** (reconcile, echo-loop origins, undo interaction) is the
  main net-new engineering and the top risk. Budget for it; it is not a drop-in.
- **Image/asset bloat** if base64 lives in the CRDT → S3 offload (Phase 2).
- **Excalidraw upgrades** — pin the version; the reconcile/onChange API is stable but watch releases.
- **Aesthetic mismatch** with the DALI design system (hand-drawn) — partially mitigated by theming.
- **CRDT schema care (CLAUDE.md):** this adds a *new* room type; it does not touch existing
  BlockNote/`doc:` documents, so risk to current collab is low. Note the new surface in the PR
  description regardless.
- **Licensing:** Excalidraw is MIT (verified). No watermark, no fee. Don't name the feature
  "Excalidraw" or imply endorsement (no formal trademark policy). tldraw was rejected because
  SDK 4.0 gates production use (watermark on the free tier / ~$6k-yr commercial).
```
