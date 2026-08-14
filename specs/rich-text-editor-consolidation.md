# Rich-text editor consolidation & image parity — spec

_Drafted July 30, 2026. Companion/follow-up to the document-signing work (PR #1087), which added a third custom node family (`signingFieldExtensions`) after images and rich blocks and re-surfaced two long-standing taxes in the shared editor. This spec is the starting point for a **separate** PR — deliberately not folded into the signing feature, because it touches mentorship, forms, partners, and page-docs and deserves its own review + regression pass. Not yet built._

The stack is already composition-based (shared extension factories in `app/components/editor/*` that each editor assembles), so this is **not** a rewrite and **not** an inheritance/god-component refactor. It's about removing two structural taxes in that composition layer, and using the result to fix the image-capability drift across surfaces.

---

## Motivation — the two taxes

**Tax 1 — editor↔viewer parity is manual.** A surface must pass matching capability flags (`enableImages`, `enableMentions`, `enableSigningFields`) to **both** the editor and its read-side `RichTextViewer`, or ProseMirror silently strips the unknown nodes on load (images/fields vanish when you stop editing). The code already carries warning comments about this (`RichTextViewer.tsx`, `blocks.ts`, `image.ts`). Every new node type re-teaches every call site the same lesson.

**Tax 2 — the toolbar is two hardcoded variants.** `RichTextEditor` renders either `Toolbar` (selection-only link bar) or `FormattingToolbar` (full, always-visible) based on the boolean `richToolbar`. Capability and UI are out of sync: you can `enableImages` and get **no button** (paste/drop only), because the Insert-image button is hardcoded into `FormattingToolbar`, not derived from "images are on."

**Symptom that prompted this:** several surfaces that *should* support images don't, and the fix today is per-call-site flag-flipping across the editor **and** its N viewers. That's the parity tax made visible.

---

## Current architecture (map)

- **Capability factories** — `app/components/editor/`: `shared.tsx` (`linkExtension`), `mention.tsx` (`mentionEditorExtension`/`mentionViewerExtension`), `image.ts` (`imageEditorExtensions`/`imageExtension`), `blocks.ts` (`richBlockExtensions`: tables/task-list/callout), `slash-menu.tsx`, `signing-fields.tsx` (`signingFieldExtensions`).
- **Non-collab editor** — `app/components/RichTextEditor.tsx`. Props gate extensions: `enableMentions`, `enableImages`, `signingRoles`, plus `richToolbar` for UI. Two toolbars: `Toolbar` (link-only, appears on selection) and `FormattingToolbar` (marks/headings/lists/image-align/link + Insert-image + signing insert controls).
- **Read view** — `app/components/RichTextViewer.tsx`. Mirrors the same flags (`enableMentions`, `enableImages`, `enableSigningFields`) — this is where the parity tax lives.
- **Collab editor** — `app/components/CollaborativeEditor.tsx` (Yjs/Hocuspocus): its own extension set overlapping `richBlockExtensions` + slash menu + drag handles.
- **Export** — `app/collab/export-html.ts` / `export-pdf.ts`: a third place node types must be taught (pure renderers keyed on node `type`).

So a single node type (e.g. images) must be declared in up to four places: editor, viewer, collab editor, and export. Presets fix the first two; the export/collab coupling is out of scope here (tracked as a note).

---

## Proposed changes (tiered — Tier 1 can ship first/independently)

### Tier 1 — targeted image fixes (small, low-risk)
Ship the immediate wins without waiting on the refactor.
- Add an **Insert-image button to the minimal `Toolbar`** (mirror the one in `FormattingToolbar`), so lightweight surfaces get a discoverable button without the full formatting bar. Paste/drop already works via the image extension regardless of toolbar.
- **Enable images on the clear-fit surfaces** (see table). Start with mentorship notes + templates, where the read view is the *same* `RichTextEditor` in disabled mode → parity is automatic.

### Tier 2 — capability presets (kills Tax 1)
- Introduce a small named preset set consumed by **both** `RichTextEditor` and `RichTextViewer` from one source — e.g. `app/components/editor/presets.ts` exporting `EDITOR_PRESETS = { field, notes, agreement, guide }`, each resolving to `{ mentions?, images?, richBlocks?, signing? }`.
- Editor + viewer take a single `preset` (or `features`) prop and derive their extension list from it. Parity becomes structural — a surface can't enable a node in the editor and forget it in the viewer.
- Keep the existing boolean flags as a thin back-compat layer during migration; migrate call sites surface-by-surface.

### Tier 3 — capability-driven toolbar (kills Tax 2)
- Replace the two hardcoded toolbars with **one toolbar that renders groups for whatever capabilities are active**: marks/headings/lists always; image (insert + align) when images on; field/variable inserts when signing on; link always. "minimal vs rich" collapses into "what's enabled."
- Result: the Insert-image button (and any future node type's controls) appears automatically wherever that capability is enabled — the enabled-but-no-button mismatch is gone by construction.

---

## Per-surface image decision

Auth reality: `/api/upload/raw` is `requireAuth`-gated but accepts **any** logged-in user (member, applicant, partner). Images therefore only fail to render in **unauthenticated** contexts — emails and public/published pages. None of the surfaces below are those, so the filter is product value + viewer-parity cost, not auth.

| Surface | Editor call site | Read view(s) | Parity cost | Recommendation |
|---|---|---|---|---|
| Mentorship notes | `mentorship/routes/mentorship.notes.$id.tsx` | same `RichTextEditor` (disabled) | free | **Enable (Tier 1)** — `richToolbar` + images |
| Mentorship templates | `mentorship/components/TemplatesModal.tsx` | flows into note editor | ~free | **Enable (Tier 1)** |
| Challenge / form description | `components/form-builder/FormBuilder.tsx` | `forms/components/MemberFormFillView.tsx`, `FormDetail.tsx`, `hiring/components/ChallengePreview.tsx`/`ChallengeDetail.tsx`/`ApplicationViewer.tsx`, `hiring/routes/domain-lead.tsx` (~6) | medium (6 viewers) | Enable in Tier 2 (presets make the 6-viewer parity a one-line change) |
| Partner "expected challenges / scope" | `partners/routes/partners.applications.$id.tsx` | `partners.applications.$id.tsx:837`, `partner.apply.tsx:322` | low (1–2) | Optional — short structured field |
| Intern-to-full "info" body | `hiring/routes/lead.intern-to-full-cycle.$id.tsx` | applicant flow viewer | low | Optional |
| Confidentiality authoring | `hiring/components/ConfidentialityAgreementDetail.tsx` | `RichTextViewer` (same file) | free | Enable for parity with the new agreement editor (it's a `SigningDocument` now) |

---

## Files likely touched

- `app/components/editor/presets.ts` — NEW (Tier 2)
- `app/components/editor/toolbar.tsx` — NEW/extracted capability-driven toolbar (Tier 3); today the toolbars live inline in `RichTextEditor.tsx`
- `app/components/RichTextEditor.tsx`, `app/components/RichTextViewer.tsx` — consume presets; minimal-toolbar image button (Tier 1)
- The editor call sites + their viewers in the table above (Tier 1/2 rollout)
- Reuse: existing factories in `app/components/editor/*` (no new extension logic — this is wiring, not new nodes)

## Non-goals

- No class inheritance / single mega-component with a giant prop matrix. Composition + presets only.
- No change to stored ProseMirror JSON, the collab (`CollaborativeEditor`) schema, or the export renderers. Switching toolbars/presets is UI + wiring; zero data/compat risk.
- Not bundled into the signing PR.

## Risks & scope discipline

- Broad blast radius (mentorship, forms, partners, page-docs) — migrate **surface-by-surface**, each with its viewer parity in the same commit, so a half-migrated surface never strips nodes on read.
- `richToolbar` on short one-line fields can feel heavy — prefer the minimal toolbar + image button there (Tier 1) rather than blanket `richToolbar`.
- Keep boolean flags working during migration so nothing breaks mid-rollout.

## Verification

- `npm run typecheck`, `npm run build`, `npm test`.
- Per migrated surface (manual, seeded DB): add an image in the editor, save, **reload**, confirm it still renders (proves editor↔viewer parity); confirm the image button appears exactly where the capability is enabled and nowhere else.
- Regression: mentorship notes visible to mentors+Core only; forms/challenges still render for applicants (authed) — spot-check an applicant view.
- Confirm no email or public/published page renders a session-authed image URL (those surfaces must stay images-off).

## Open questions

1. Preset names/shape — `preset="notes"` vs an explicit `features={{ images: true }}` object. Presets are more declarative; a features object is more flexible. Lean presets with an escape-hatch object.
2. Do we also unify `CollaborativeEditor` onto the same preset/toolbar model, or leave it separate for now? (It has extra machinery — drag handles, slash menu, awareness — so probably a later, separate step.)
3. Should the capability-driven toolbar keep a "compact" density option for short fields, or is "minimal = fewer capabilities enabled" enough?
