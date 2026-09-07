# File-type classification & preview consolidation — spec

_Drafted September 6, 2026. Follows a file-type audit of the Drive: the system stores almost anything (permissive by design) but "what is this file / can we show it" is re-derived independently in five surfaces, three of which disagree. This spec is the starting point for a **separate** refactor PR — a net-negative-lines consolidation with a few behavior-consistency fixes as a side effect, plus a clean seam for future viewers (Office/3D). Not yet built._

The intake side is already done right: `app/lib/file-validation.ts` is a single client-safe module ("can it come in?") shared by the presign route and the MCP upload tool so the two paths can't drift. This spec adds its missing read-side sibling ("what is it / how do we show it?") and points the five viewer surfaces at it. It is **not** a rewrite, **not** a new upload allow-list, and **not** a runtime plugin system.

---

## Motivation — one concern, answered five times

"What kind of file is this, and can we preview it?" is currently decided by four different classifiers keyed off two different signals (MIME vs. filename), plus a fifth surface that punts entirely:

| Surface | File:line | Signal | Previews inline |
|---|---|---|---|
| Full file page (`FilePreview`) | `app/components/FilePreview.tsx:40-47` | MIME (ext fallback) | image, video, audio, **pdf, text** |
| Drive Quick Look (spacebar) | `app/components/drive/DriveBrowser.tsx:207-210` | **filename regex** | image + pdf **only** |
| Partner portal modal | `app/partners/components/PartnerProjectHubView.tsx:475-479` | MIME | image, pdf, text — **no video/audio** |
| Compact attachment row (`FileAttachment`) | `app/components/FilePreview.tsx:134` | MIME | image thumbnail only |
| Hiring answers | `app/hiring/components/ApplicationAnswers.tsx:61-88` | — | none (download-only) |

The disagreement is not cosmetic — it produces observable bugs:

- **A `.mp4` plays on the file page, shows "no preview" in Drive Quick Look, and is a bare download link in a partner modal.** Same file, three answers.
- **`.bmp`/`.avif` preview in Drive but not on the file page.** Drive's regex (`DriveBrowser.tsx:209`) lists `bmp|avif`; `FilePreview`'s `EXT_TYPE` map (`FilePreview.tsx:12-30`) does not, so a bmp with no stored `contentType` falls through to the download fallback there.
- **`application/octet-stream` never previews anywhere.** Uploads with an empty `File.type` are stored as octet-stream (`upload-client.ts:29`); `inferContentType` returns it verbatim, so a perfectly-viewable PDF uploaded without a MIME type is undecodable.

Each of these is a place a surface re-teaches itself MIME rules instead of asking a shared function.

### SOLID framing

- **DRY** — extension→MIME→category logic exists in ≥4 copies; `getExtension` is duplicated between `FilePreview` and `file-validation.ts`.
- **SRP** — `FilePreview.tsx` owns *both* classification (`EXT_TYPE`, `inferContentType`, `kindOf`) and rendering.
- **OCP** — adding Office/3D preview today means editing all five surfaces and their gates; nothing is closed to modification.
- **DIP** — surfaces depend on raw MIME string checks (`ct.startsWith("image/")`) rather than an abstraction; "pdf is previewable" is hardcoded per call site.

---

## Current architecture (map)

- **Intake / validation** — `app/lib/file-validation.ts`: `MAX_UPLOAD_BYTES` (10 MB), `BLOCKED_UPLOAD_TYPES`/`_EXTENSIONS` (executables), `isBlockedUpload`, `fileMatchesAccept`, and a private `getExtension`. Client-safe, shared by `api.upload.presign.ts` + the MCP upload tool. **Keep — this is the template.**
- **Classification (scattered)** — `FilePreview.tsx`: `EXT_TYPE` (ext→MIME), `inferContentType`, `kindOf` (MIME→`Kind`). Plus the `DriveBrowser.isPreviewable` regex and the partner modal's inline `isImage/isPdf/isText`.
- **Rendering (per surface)** — `FilePreview`/`FileAttachment` (`FilePreview.tsx`), `DriveQuickPreview` (`DriveBrowser.tsx:~2218-2293`), `SharedFilePreviewModal` (`PartnerProjectHubView.tsx:468-551`). Each an `if`-chain over `<img>`/`<video>`/`<audio>`/`<iframe>` + a download fallback.
- **Inline-serving URL contract (implicit)** — the file page builds a dedicated `previewUrl` (presigned S3, `inline: true` + forced `contentType`, `documents.file.$fileId.tsx:152-155`) so the browser renders even when the stored Content-Type is wrong. The partner modal skips this and feeds `downloadUrl` straight into its `<iframe>` (`PartnerProjectHubView.tsx:524-529`) — so PDF/text preview is less reliable there. A viewer needs an inline-disposition URL; that requirement is currently tribal knowledge.
- **Icons** — `DriveBrowser.itemIcon` (`DriveBrowser.tsx:307-340`) switches on Drive *item kind*, not file type: every uploaded file — pdf, png, mp4, docx — renders one generic `Paperclip`.

---

## Proposed changes (tiered — Tier 1 ships first/independently)

### Tier 1 — extract the classifier (kills DRY/SRP, fixes the inconsistencies)

New client-safe module `app/lib/file-type.ts` — the single source of truth, sibling to `file-validation.ts`:

```ts
export type FileCategory =
  | "image" | "video" | "audio" | "pdf" | "text"
  | "office" | "archive" | "model3d" | "other";

export function getExtension(name: string): string;          // moved here; file-validation imports it
export function resolveContentType(name: string, provided?: string | null): string;
export function categorize(input: { fileName: string; contentType?: string | null }): FileCategory;

const PREVIEWABLE = new Set<FileCategory>(["image", "video", "audio", "pdf", "text"]);
export const canPreviewInline = (c: FileCategory) => PREVIEWABLE.has(c);   // the ONE gate
```

- `resolveContentType` prefers a real MIME type but falls back to the extension map when `provided` is missing **or `application/octet-stream`** — closing the octet-stream and bmp/avif gaps.
- `EXT_TYPE` moves out of `FilePreview.tsx` into `file-type.ts` and gains the entries the Drive regex already implied (`bmp`, `avif`).
- `file-validation.ts` imports `getExtension` from here instead of its own copy (one extension parser in the codebase).

Then repoint the five surfaces (see migration table). Note the URL constraint discovered during Tier 1–3 implementation: a Drive file `DriveItem`'s `href` is the file *page* (`/documents/file/<id>`), **not** an inline media URL, so Drive Quick Look can only render what an `<img>`/`<iframe>` loads from that surface — images + PDFs. `isPreviewable` therefore stays `cat === "image" || cat === "pdf"` (shared classifier, surface-narrowed), *not* the full `canPreviewInline`. Widening Quick Look to video/audio/text would need an inline URL on the Drive item first — a separate change.

### Tier 2 — viewer registry (kills OCP)

Replace the three duplicated `if`-chains with one category→component map in `app/components/file/`:

```ts
const VIEWERS: Record<FileCategory, FC<ViewerProps>> = {
  image: ImageViewer, video: VideoViewer, audio: AudioViewer,
  pdf: FrameViewer, text: FrameViewer,
  office: DownloadFallback, archive: DownloadFallback,
  model3d: DownloadFallback, other: DownloadFallback,
};
```

`ViewerProps` formalizes the URL contract: `{ inlineUrl, downloadUrl, fileName, contentType? }`, where `inlineUrl` MUST serve with inline disposition + a correct Content-Type (what the file page already does; the partner modal gets fixed by passing a real inline URL). The three surfaces keep their **own chrome** (70vh panel vs. thumbnail row vs. modal) — they share the *decision* (`categorize`) and the *renderers* (`VIEWERS`), not the layout. Merging the layouts too would just relocate the SRP problem.

Adding Office preview later = write `OfficeViewer`, swap one map entry, add `"office"` to `PREVIEWABLE`. **Zero edits to any surface.**

### Tier 3 — per-type Drive icons (kills the paperclip-for-everything)

`app/lib/file-icon.tsx`: `iconForCategory(category)` → distinct glyph (FileImage / FileVideo / FileAudio / FileText for pdf+text / generic Paperclip for other). `DriveBrowser.itemIcon`'s `case "file"` calls `iconForCategory(categorize(item))` instead of a hardcoded `Paperclip`. Same classifier feeds the icons — no second taxonomy.

---

## Per-surface migration table

| Surface | Was | Becomes |
|---|---|---|
| `FilePreview` / `FileAttachment` | local `kindOf` / `inferContentType` / `EXT_TYPE` | import `categorize` + `VIEWERS`; delete the locals |
| `DriveBrowser.isPreviewable` | `/\.(png\|jpe?g\|…\|pdf)$/` on filename | `categorize(item)` → `image`/`pdf` (Drive item has no inline URL for other media) |
| `DriveQuickPreview` | inline `<img>`/`<iframe>` if-chain | `<FileViewer category=… />` |
| `SharedFilePreviewModal` (partner) | inline `isImage/isPdf/isText`; `downloadUrl` into iframe | `categorize` + `VIEWERS`; pass a real `inlineUrl` |
| `ApplicationAnswers` (hiring) | download-only | optional: use `canPreviewInline` to offer inline preview where it applies (product call — may stay download-only for applicant privacy) |
| `DriveBrowser.itemIcon` `case "file"` | `Paperclip` for all | `iconForCategory(categorize(item))` |
| `file-validation.ts` | private `getExtension` | import from `file-type.ts` |

---

## Files touched

- `app/lib/file-type.ts` — NEW (Tier 1)
- `app/components/file/FileViewer.tsx` + `viewers.tsx` — NEW registry (Tier 2); extracted from `FilePreview.tsx`
- `app/lib/file-icon.tsx` — NEW (Tier 3)
- `app/components/FilePreview.tsx` — consume registry; drop local classifier
- `app/components/drive/DriveBrowser.tsx` — `isPreviewable`, `DriveQuickPreview`, `itemIcon`
- `app/partners/components/PartnerProjectHubView.tsx` — `SharedFilePreviewModal` + supply an inline URL
- `app/lib/file-validation.ts` — import shared `getExtension`
- (optional) `app/hiring/components/ApplicationAnswers.tsx`

## Non-goals

- **No runtime plugin system / "file provider" interface.** Nine categories don't justify it; a plain map object is the right altitude and stays within repo scope discipline.
- **No change to the upload model** — still permissive (block-list only), still 10 MB, no new allow-list. This is read-side only.
- **No merging of the three viewer chromes** into one mega-component with a variant matrix.
- **No collab-doc change.** Embedding uploaded files *into* BlockNote docs (the embed block is a link card today) is a separate feature, noted below, not this refactor.
- **No new dependency** — browser-native `<img>/<video>/<audio>/<iframe>` only, as today. No react-pdf/pdfjs.

## Risks & scope discipline

- **Behavior changes are intentional but must be called out in the PR:** octet-stream and bmp/avif start previewing on the full file page + partner modal; Drive files show per-type icons instead of one paperclip; partner files with a null content type but a known extension now classify by extension. Each is a consistency fix, but list them so reviewers can veto any. (Drive Quick Look preview set is unchanged — still image+pdf — per the URL constraint above.)
- **Blast radius spans Drive, partner portal, hiring, education.** Migrate surface-by-surface, each in its own commit, so a half-migrated state never regresses.
- **Partner inline URL** — the modal must be handed an inline-disposition URL; if the partner loader only exposes `downloadUrl`, that loader needs the same `inline: true` presign the file page uses. Don't ship the partner migration until that URL exists, or PDFs will download instead of render.
- `categorize` is pure and unit-testable — lock the classification table with a Vitest table test (ext-only, MIME-only, octet-stream fallback, conflicting ext-vs-MIME) so future edits can't silently reintroduce the drift.

## Verification

- `npm run typecheck`, `npm run build`, `npm test` (add `file-type.test.ts`).
- Manual (seeded DB), one file of each category: confirm identical preview behavior on the file page **and** Drive Quick Look **and** (for shared files) the partner modal — the three must now agree.
- Regression: upload a PDF with no extension / as octet-stream → previews. Upload a `.docx` → clean "no preview + download" fallback, not a broken iframe.
- Drive list: pdf/image/video files show distinct icons, not all paperclips.

## Open questions

1. **Category granularity** — is `office`/`archive`/`model3d` worth splitting out now (they all fall back to download), or start with the current five + `other` and add categories when a real viewer lands? Leaning: define the enum fully now (cheap, and the icons benefit immediately), wire only the five real viewers.
2. **Hiring inline preview** — should applicant-submitted files stay download-only for a deliberate privacy/friction reason, or inherit `canPreviewInline` like everywhere else? Needs a product call.
3. **Office/3D preview** — out of scope here, but the registry is the seam. When it's built: Microsoft/Google web viewer iframe (external, needs a public URL — conflicts with auth-gated S3) vs. a client-side lib. Flag for its own spec.
4. **Embedding files into collab docs** — the biggest real gap (can't drop a PDF into a meeting-note). Separate feature; note that `categorize`/`VIEWERS` would be its rendering primitive so the two shouldn't diverge.

---

# Capability roadmap (post-consolidation)

Tiers 1–3 are pure cleanup — they change *how* the current preview set is computed, not *what* previews. Tiers 4–8 are the payoff: the registry is now an OCP seam, so each one is "write a viewer, add a map entry, add the category to `PREVIEWABLE`" with **zero call-site edits**. They map 1:1 onto the gaps the file-type audit surfaced (Office stored-but-unviewable, no file embedding in docs, no thumbnails, 3D/CAD uploads with no viewer). Each is an independent PR with its own spec; this section is the sequencing plan, not the specs themselves.

**None of Tiers 4–8 should start before Tier 2 lands** — they all consume `VIEWERS`/`categorize`, and building them against the current five-way-duplicated logic would just multiply the drift.

## Tier 4 — Rich text-family viewers (low effort, no infra, no decision)

Today the whole `text` category is a raw `<iframe src=inlineUrl>` — no theming, no dark mode, inherits browser chrome. Split `TextViewer` into content-aware sub-renderers that `fetch()` the file body (≤10 MB, cheap) and render client-side:

- **Markdown** (`text/markdown`, `.md`) → rendered, sanitized (not raw source).
- **Code** (`.ts/.js/.py/.css/.json`, `text/*`) → read-only syntax highlight.
- **CSV** (`text/csv`, `.csv`) → parsed HTML table, sticky header.
- **Plain** (`text/plain`) → themed `<pre>`, wrapped.

- **New deps:** a highlighter (shiki/prism) + a markdown sanitizer (marked + DOMPurify). These are the "stack genuinely lacks it" case the no-new-deps rule allows — flag in the PR.
- **Caveat:** client-side `fetch()` of the presigned S3 URL needs bucket **CORS** for GET (today only `<img>`/`<iframe>` load it, which don't require CORS). Verify/add the CORS rule first.
- **Value/effort:** medium value, low effort, no gating decision. **Ship first, right after 1–3.**

## Tier 5 — Office preview (docx / xlsx) — ❌ DROPPED (2026-09-06)

**Dropped from the roadmap by Kiran — skip entirely.** Office preview is rare enough at DALI that it's not worth the new client deps (`mammoth`/SheetJS) or the bucket-CORS prerequisite; docx/xlsx/pptx all stay download-only via the `other`/`office` → `DownloadFallback` path. The `office` category still exists in `file-type.ts` (for icons + the fallback), just with no dedicated viewer. Original plan retained below for the record.

---

Audit finding: Office formats store fine, preview nowhere. **Decision (2026-09-06): pptx is a low/near-never preview event at DALI, so it stays download-only.** That removes the one capability that would have needed a heavy server rail (pptx fidelity is the only thing client-side libs can't do well), so Office preview is entirely client-side:

- **docx** → `mammoth` (docx→HTML), sanitized (DOMPurify), rendered in a scroll panel.
- **xlsx** → `SheetJS` → HTML table (shares the table renderer with the Tier 4 CSV viewer).
- **pptx, legacy `.doc`/`.ppt`, everything else** → `DownloadFallback` (accepted gap).

- Registry: the `office` category dispatches to `DocxViewer`/`SheetViewer` by extension; pptx routes to `DownloadFallback`.
- Rendering happens in the user's tab (`fetch` the presigned URL bytes) — files never hit our compute, and untrusted parsing stays in the browser sandbox, not our servers. Best on both privacy and security (same logic that disqualified external viewers now favors client-side).
- **New deps:** `mammoth`, `xlsx` (SheetJS) — the "stack genuinely lacks it" case; flag in the PR.
- **Needs bucket CORS** for browser `fetch()` (same prerequisite as Tier 4).
- **No LibreOffice, no Gotenberg, no worker, no gating decision.**

> Rejected: (A) server-side LibreOffice→PDF — full fidelity incl. pptx, but ~1 GB in the image / a Gotenberg sidecar + moves untrusted parsing onto our infra; not worth it once pptx is out. (C) external Office Online / Google viewer — needs a *public* URL, leaks confidential hiring/partner files to a third party; disqualified for this data.

## Tier 6 — 3D / CAD preview (niche, client-side)

Forms already accept `.f3z,.f3d` (`FormBuilder.tsx:22-25`), so 3D uploads exist with no viewer.

- **Web-native** (`.glb/.gltf`, `.stl`, `.obj`) → `<model-viewer>` web component (self-hostable, minimal build cost) or three.js loaders. All client-side, ≤10 MB fine.
- **Fusion** (`.f3d/.f3z`) are proprietary Autodesk archives — not web-renderable without Autodesk's cloud API. Stay download-only (a Forge integration is a separate, out-of-scope effort).
- **New dep:** `@google/model-viewer` (light) preferred over raw three.js.
- **Value/effort:** niche (DALI hardware/design teams) but low-medium effort and fully client-side. **Do when a team asks.**

## Tier 7 — Drive thumbnails / visual grid (the only remaining worker question)

Make Drive grid view show visual thumbnails like Finder/Google Drive instead of type icons, for image/pdf/video. Two ways, and with Tier 5 resolved this is the *only* place a worker is even a candidate:

- **Client-side (zero infra):** image → CSS-downscaled `<img>`; pdf → `pdf.js` first-page-to-canvas; video → `<video>`+canvas at t=1s. Works, but re-renders on every grid paint and ships full-size bytes to the client to downscale.
- **Server-cached (needs a worker for pdf/video):** a background job generates + stores small thumbnails (`sharp` for images, `pdf.js`/poppler for pdf, ffmpeg for video keyframes) → S3 `thumbKey` on `ProjectFileVersion` (needs `thumbKey`/`thumbStatus` columns → **migration**). Grid renders the tiny cached thumb; falls back to `iconForCategory` (Tier 3).

- **Key split:** `sharp` image thumbnails are light enough to run in the **existing in-process runner** — no worker, no new process group. It's only pdf-raster + video-keyframe caching that wants an isolated worker.
- **Recommendation:** ship **image thumbnails via `sharp` in the existing runner** (or client-side CSS downscale for a zero-infra start); leave pdf/video grid thumbnails **client-side (`pdf.js`/canvas)** until the grid demonstrably needs cached ones at volume. That keeps the whole roadmap worker-free.
- **Value/effort:** high polish, medium effort for the image cut; defer the pdf/video-cached piece.

## Tier 8 — Embed files into collab docs (highest product value)

Closes the audit's biggest gap: today the doc embed block is just a link card (`doc/schema/embed.tsx`); you can't drop a PDF into a meeting note or a design mock into a project doc.

- **New BlockNote block** `fileEmbed` storing `{ fileId | s3Key, fileName, contentType }`; both read and edit render the shared `<FileViewer>` inline — **the doc becomes a sixth surface consuming the registry**, exactly the OCP payoff.
- **Insertion:** slash-menu "Embed file" → Drive file picker (reuse the DestinationPicker pattern), plus generalize the existing image drag-drop (`doc/upload.ts`) so dropping *any* file creates a `ProjectFile` + inserts the block.
- **Collab tax (CLAUDE.md):** a new block type must be taught to the collab schema (`DocEditor`/`features.ts`), the read path, **and** the export renderers (`export-html.ts`/`export-pdf.ts`) — or it strips on load/export. Same parity tax as the rich-text spec; follow that discipline (declare the node everywhere in one commit). Flag as a CRDT-schema change in the PR.
- **Value/effort:** highest value, medium effort, reuses the registry for all rendering. **The flagship follow-on after Tier 4.**

## Sequencing

```
Tiers 1–3  (consolidation)        ── one PR, ships first
   │
   ├── Tier 4  (rich text/CSV/code)   ── cheap, client-side; ship right after
   ├── Tier 5  (docx/xlsx client-side; pptx download-only)  ── no infra
   ├── Tier 8  (embed in docs)        ── flagship value; collab-schema care
   ├── Tier 6  (3D/CAD)               ── client-side, independent; on demand
   └── Tier 7  (thumbnails)           ── image via sharp in existing runner;
                                          pdf/video cached = deferred
```

Every tier depends only on the registry (Tiers 1–2). **All are infra-free** — client-side rendering plus, at most, `sharp` image thumbnails in the existing in-process runner. Ship in whatever order product value dictates; Tier 4 is the cheapest warm-up, Tier 8 the highest-value follow-on.

## Resolved: no processing worker

The earlier fork — stand up a LibreOffice/ffmpeg worker on Fly — is **resolved NO** (2026-09-06):
- pptx preview is low/near-never at DALI, so nothing needs LibreOffice-grade fidelity; docx/xlsx render client-side (`mammoth`/SheetJS).
- The image already ships headless Chromium + an HTML→PDF rail (`app/lib/pdf/print-html.server.ts`), so even if a server render were wanted later it wouldn't start from zero.
- The only surviving worker candidate is *cached pdf/video Drive-grid thumbnails* (Tier 7) — deferrable polish, and image thumbnails need only `sharp` in the existing runner.

**Revisit only if** (a) pptx preview becomes common, or (b) the Drive grid demonstrably needs cached pdf/video thumbnails at volume. Neither blocks any tier today.
