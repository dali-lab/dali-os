# Unified floating-menu system

Design + migration plan for replacing every hand-rolled dropdown/menu/popover in
the app with one reusable, accessible primitive.

**Supersedes `selectmenu-rollout.md`.** That doc tracked a per-file `SelectMenu`
rollout; this one folds `SelectMenu` into a proper foundation and unifies *all*
floating surfaces, not just native `<select>`.

**Decisions (locked):** build on **`@floating-ui/react`**; scope is **full
unification** — Select + Menu + ContextMenu + Tooltip on one primitive, and every
existing hand-rolled float migrates onto it.

---

## 1. The problem

### 1a. Native `<select>` can't be our design system

`<option>` is OS-rendered. You cannot cross-browser style the open popup, render
per-row descriptions / checkmarks / icons, or portal the popup out of a clipping,
scrollable dialog. That constraint is the *entire reason* `SelectMenu` exists
(`app/components/ui/SelectMenu.tsx:5-9`). "Just style the select" is a non-starter.

### 1b. The current `SelectMenu` drop-in is itself a hacky fix

Four structural flaws — the "Conversion rules" in `selectmenu-rollout.md` are
really a catalogue of ways it bites:

1. **Auto-submit trap** (`selectmenu-rollout.md:26-32`). Form participation is
   faked with a hidden mirror `<select>` (`SelectMenu.tsx:119-137`) whose value
   lags React by a render, so re-submitting the form DOM in the same tick submits
   the **stale** value. Every form-mode conversion must hand-route around this —
   which is why ~30 files are "deferred due to submit-bug risk."
2. **No keyboard support.** Opening doesn't move focus into the list; there are no
   arrow keys, no type-ahead, no roving tabindex (`SelectMenu.tsx:156-192` is
   click-only). Native `<select>` gives all of that free, so every conversion is a
   quiet **a11y regression**.
3. **Close-on-scroll is a cop-out.** It hand-computes a `position: fixed` rect
   once, so any scroll/resize just **closes** the menu (`SelectMenu.tsx:101-103`)
   instead of repositioning.
4. **Every conversion is manual prop preservation** — value, label, `name`,
   `required`, `disabled`, per-option `disabled`, width classes. Error-prone ×85.

### 1c. `SelectMenu` is one of ~15 copies of the same plumbing

Every floating surface re-implements portal + `getBoundingClientRect` +
outside-click + Escape + (inconsistent) keyboard/focus. Two *partial* shared
abstractions exist and neither is enough:

- `useDismissableMenu` (`app/hooks/useDismissableMenu.ts`) — dismiss only, no
  positioning/portal/keyboard. Used by `PortalProfileMenu`, `Breadcrumbs`,
  `partner-layout`.
- `SelectMenu` — positioning + portal, but select-only, and flawed per 1b.

Full inventory of hand-rolled floats in §6.

---

## 2. Decision & rationale

| | Choice | Why |
|---|---|---|
| Foundation | `@floating-ui/react` | Headless positioning (`offset`/`flip`/`shift`/`autoUpdate`) **and** interaction hooks (`useListNavigation`, `useTypeahead`, `useDismiss`, `useRole`, `useHover`, `useFocus`). One engine powers select, menu, context menu, and tooltip. It's the layer under Radix/Headless UI. Hand-rolling these across 15 migrations is exactly the code that's easy to get subtly wrong. |
| Scope | Full unification | One primitive; zero remaining hand-rolled floats. Deletes `useDismissableMenu` and folds all ⋯/profile/breadcrumb/picker/context/tooltip surfaces in. |

`@floating-ui/react` is a **new direct dependency** (only present transitively
today via `@blocknote/shadcn`). Small, tree-shakeable, React 19 compatible.

---

## 3. Architecture — three layers

```
Layer 1 — the primitive  (app/components/ui/floating/)
  useFloatingSurface(): portal + offset/flip/shift + autoUpdate (reposition, not
  close) + useDismiss (outside-click/Escape) + focus return. Returns refs, styles,
  and getReferenceProps/getFloatingProps to spread.
        │
        ├── Layer 2a  <Select>       value picker  (useListNavigation + useTypeahead + useRole listbox)
        ├── Layer 2b  <Menu>         action menu   (useListNavigation + useRole menu)
        ├── Layer 2c  <ContextMenu>  right-click    (Menu anchored to a virtual element at the cursor)
        └── Layer 2d  <Tooltip>      hover/focus    (useHover + useFocus + useRole tooltip)
```

Layer 1 is where positioning/dismiss/focus live **once**. Layer 2 components are
thin (~50–90 lines each) and Tailwind-styled to match today's look (`bg-card`,
`border-border`, `shadow-brand-2`, coral accent).

---

## 4. Component APIs

### 4a. `<Select>` — replaces `SelectMenu` + native `<select>`

Same option shape as today (`value`/`label`/`description`/`disabled`), plus icon.
Two modes, unchanged surface for existing call sites:

```tsx
// Controlled / filter
<Select value={term} onChange={setTerm} options={opts} ariaLabel="Term" />

// Form field (hidden input carries the value)
<Select name="role" defaultValue="Member" options={roleOpts} required />
```

**Form-value fix (kills the auto-submit trap structurally).** Drop the mirror
`<select>`. Keep a single hidden `<input type="hidden" name>` and set its `.value`
**imperatively in the same `onSelect` tick, via ref, before calling `onChange`**:

```tsx
function choose(v: string) {
  if (hiddenRef.current) hiddenRef.current.value = v;  // synchronous — DOM is fresh NOW
  if (!isControlled) setInternal(v);
  onChange?.(v);
  setOpen(false);
}
```

Any synchronous `new FormData(form)` / `submit(formRef)` reads the fresh value.
**The per-file "submit the value explicitly" rule is no longer needed** — but we
keep option `value`s/labels, `defaultValue`, `name`, `required`, `disabled`, and
width classes intact per call site.

**Keyboard parity with native:** `useListNavigation` (arrows, Home/End, roving
tabindex) + `useTypeahead` (jump-to by typing). Open moves focus into the list;
Escape/blur returns focus to the trigger.

**Migration of the 18 existing `SelectMenu` call sites is free:** reimplement
`SelectMenu` on top of `<Select>` (or re-export), so the "Done" list keeps working
without edits; new work imports `<Select>` directly.

### 4b. `<Menu>` — replaces the `role="menu"` action menus

Items are actions or links (both exist today — `documents.hub` uses buttons,
`PortalProfileMenu` uses `<Link>`s). Supports a custom trigger, icons, disabled,
destructive styling, sections/separators, and `align`.

```tsx
<Menu align="right" trigger={<button aria-label="More ways to add"><ChevronDown/></button>}>
  <Menu.Item icon={<FolderPlus/>} disabled={busy} onSelect={createLabFolder}>New folder</Menu.Item>
  <Menu.Item icon={<LayoutTemplate/>} onSelect={openTemplatePicker}>From template…</Menu.Item>
</Menu>

<Menu trigger={<ProfileChip/>} align="right">
  <Menu.LinkItem to={settingsTo}>Settings</Menu.LinkItem>
  <Menu.LinkItem to="/logout" muted>Sign out</Menu.LinkItem>
</Menu>
```

Closes on select automatically; `useListNavigation` + `useRole('menu')` give
arrow-key nav and correct ARIA. The split-button in `documents.hub` keeps its
left/right structure — only the popup half becomes `<Menu>`.

### 4c. `<ContextMenu>` — replaces right-click menus (`TabWorkspace`, `calendar`)

Same item API as `<Menu>`, anchored to a **virtual element at the pointer**
(floating-ui virtual anchor) instead of a trigger button:

```tsx
<ContextMenu onOpen={(e) => selectRowUnderCursor(e)}>
  <Menu.Item onSelect={rename}>Rename</Menu.Item>
  <Menu.Item destructive onSelect={remove}>Close tab</Menu.Item>
</ContextMenu>
```

### 4d. `<Tooltip>` — replaces the hand-rolled tooltip in `IconButton`

`useHover` (with delay) + `useFocus` + `useRole('tooltip')`, portaled.

```tsx
<Tooltip label="Archive"><IconButton icon={<Archive/>} /></Tooltip>
```

---

## 5. Accessibility (parity target = native `<select>` / native menu)

- Roles via `useRole`: `listbox`/`option` (Select), `menu`/`menuitem` (Menu),
  `tooltip` (Tooltip).
- Keyboard: Arrows/Home/End, Enter/Space to activate, Escape to close, type-ahead
  on Select, roving tabindex via `useListNavigation`.
- Focus: moves into the panel on open, returns to trigger on close (`useDismiss` +
  floating-ui focus management). `aria-expanded`/`aria-haspopup` on triggers.
- Portaled panels use `FloatingPortal`; positioning via `autoUpdate` so they track
  the anchor through scroll instead of vanishing.

---

## 6. Migration inventory (verified against the tree)

### Native `<select>` → `<Select>`  (~30 files, ~85 selects)

Counts confirmed by grep; all match `selectmenu-rollout.md` except the additions
noted. Batch by area, verify per batch.

- **Hiring:** `lead.cycle.$id.tsx` (28 — split carefully), `lead.intern-to-full-cycle.$id.tsx` (5), `domain-lead.tsx` (5), `applications.tsx` (3), `onboarding.tsx` (2 — plus a `role=menu`, see below), `lead.tsx` (1), `interviews.$interviewId.tsx` (1), `applications.$domainApplicationId.tsx` (1)
- **Projects:** `TaskModal.tsx` (8; assignee `<select multiple>` stays native), `EpicSprintManager.tsx` (8), `projects.$id.tsx` (3), `MemberCard.tsx` (3), `projects.hub.tsx` (4), `projects.$id.public-view.tsx` (1)
- **Education:** `ManageCourseContent.tsx` (4), `education.manage.$offeringId.tsx` (3), `RosterMatrix.tsx` (2), `OfferingFields.tsx` (1)
- **Partners:** `partners.applications.tsx` (4), `partners.applications.$id.tsx` (3), `partners.$orgId.tsx` (3)
- **Signing:** `SigningDocumentsPage.tsx` (4), `SigningDocumentDetail.tsx` (2)
- **Members/Forms/Calendar:** `MemberProfileView.tsx` (4), `NoteShareModal.tsx` (1), `form-builder/QuestionField.tsx` (5), `form-builder/FormBuilder.tsx` (3), `forms.responses.$formId.tsx` (2), `calendar.tsx` (12 — time-of-day pickers are large lists, keep native)
- **➕ Doc correction:** `components/sharing/ShareDialog.tsx:264` — the "Or add a group" picker is still a native `<select>`; the doc marked ShareDialog fully done but missed this one.

### `role="menu"` action menus → `<Menu>`

`PortalProfileMenu.tsx`, `Breadcrumbs.tsx`, `partners/routes/partner-layout.tsx`,
`hiring/routes/onboarding.tsx:494`, `routes/documents.hub.tsx:982` + `:1000`
(split-button "New document" menu).

### Pickers / popovers → primitive (or `<Menu>`)

`TagPicker.tsx`, `doc-chrome/PageIconPicker.tsx`, `doc-chrome/DocToc.tsx`,
`MentionTextInput.tsx`, `doc/ai/AiCardHost.tsx`, `doc/ai/AiBar.tsx`,
`doc/find/FindReplaceBar.tsx`.

### Right-click → `<ContextMenu>`

`components/TabWorkspace.tsx`, `calendar/routes/calendar.tsx`.

### Tooltip → `<Tooltip>`

`components/ui/IconButton.tsx`.

### Delete after migration

`app/hooks/useDismissableMenu.ts` (absorbed into Layer 1).

---

## 7. Keep native / out of scope (unchanged from prior doc)

- `<select multiple>` — `TaskModal` assignee (multi-select).
- Huge dynamic lists (>~25 options) where a menu is worse UX: `portal.settings.tsx`
  timezones (500+), `admin.activity.tsx` (~117 audit actions), `calendar.tsx`
  time-of-day selects.
- `admin.domains.tsx` — the select is an invisible overlay over a styled badge
  (bespoke UX; `admin.domains.tsx:317,351`).

---

## 8. Phased plan & verification

0. **Foundation** ✅ DONE — added `@floating-ui/react`; built `ui/floating/`
   (`Select`/`Menu`/`ContextMenu`/`Tooltip` + shared styles). `SelectMenu` was
   NOT aliased — it was deleted and all 18 call sites ported to `Select`.
   Typecheck/build/tests green.
1. **Selects** → `<Select>` ✅ DONE — ~119 native selects across 30 files. Skipped
   (kept native, by rule): `RosterMatrix` bulk-mark selects (a "Mark all" button
   reads their DOM `.value`), `MemberProfileView` timezone (400+), `TaskModal`
   assignee is a custom checkbox list (no native multi-select present).
2. **Action menus** → `<Menu>` ✅ DONE — `PortalProfileMenu`, `Breadcrumbs`,
   `partner-layout`, hiring `onboarding`, `documents.hub` split-button, and the
   Signing variable-inserter (was a reset-to-"" `<select>` hack → real `Menu`).
   `useDismissableMenu` deleted (no importers left).
3. **Pickers/context/tooltip** → primitive/`ContextMenu`/`Tooltip` ⏳ REMAINING.
   Plain-browser popovers (valid targets): `TagPicker`, `PageIconPicker`,
   `DocToc` (absolute jump menu), `MentionTextInput` (@-mention autocomplete on a
   plain `<textarea>/<input>` — combobox pattern), `FindReplaceBar` (imports
   `BlockNoteEditor` as a *type* only; its bar UI is plain React), `TabWorkspace`
   right-click → `ContextMenu`, `IconButton` tooltip → `Tooltip` (note: `Tooltip`
   is re-exported from `IconButton` and imported by ~24 files — repoint those).
   `calendar` right-click → `ContextMenu`.

   **Excluded — BlockNote/ProseMirror-owned, do NOT swap:** `AiCardHost` (renders
   in `@blocknote/react`'s `BlockPopover`, anchored into the editor subtree via
   `editor.prosemirrorView.dom`) and `AiBar` (registers ProseMirror plugins,
   positions against the editor selection; it's the content of AiCardHost's
   block-anchored card). Their anchoring is the editor library's responsibility —
   replacing it with a generic floating primitive would be wrong and is the class
   of change CLAUDE.md flags for breaking document sync.

**Per batch:** `npm run typecheck`, `npm test`, `npm run build`; manual keyboard/
focus check on a representative surface.

**CRDT / desktop caveats to flag in the PR:** `documents.hub`, `DocToc`,
`AiCardHost`, `AiBar`, `MentionTextInput`, `FindReplaceBar` are collab-editor
chrome; `documents.hub` action routes are desktop-app dependencies. Migrations
there must be behavior-preserving (styling/plumbing only, no editor-schema or
route-contract changes).
