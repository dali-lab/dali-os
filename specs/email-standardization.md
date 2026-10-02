# Outbound Email Standardization — Audit & Plan

**Status:** BUILT 2026-10-01, rollout steps 0-6 · **Date:** 2026-10-01 · **Branch:** `worktree-feat+email-templates-standardize` off `staging` · **Flag:** `email-layout` (off)
**Scope:** every outbound email in the app — one layout, one template registry, one editor, operator-editable without a deploy.

## Build status

| Step | State | Commit |
|---|---|---|
| 0 — defect fixes | ✅ built, no flag | `Email Phase 0` |
| 1 — layout + MIME envelope | ✅ built behind `email-layout` | `Email Phases 1-3` |
| 2 — notify() + digest on the layout | ✅ built | `Email Phases 1-3` |
| 3 — auth | ✅ built | `Email Phases 1-3` |
| 4 — registry + store collapse + `/admin/email` | ✅ built, data-losing migration | `Email Phase 4` |
| 5 — partners, signing, education | ✅ built | `Email Phase 5` |
| 6 — copy gaps | ✅ built | `Email Phase 6` |
| §3.5 — every notification's wording made editable | ✅ built | `Email §3.5` |

**Everything the app sends is now operator-editable: 77 templates in one editor**
— 19 feature templates plus 58 notification messages.

### How §3.5 resolved the vocabulary question

The survey of all 44 `notify()` call sites answered it: **24 of them interpolate
some variant of "the title of the thing"** — a meeting, a task, a document, a
course, a form, a project. So seven generic tokens cover everything rather than
twenty near-duplicates nobody could keep straight: `itemTitle`, `itemDetail`,
`contextName`, `personName`, `when`, `statusLabel`, `count`, under a new
`notification` template context.

**Call sites pass those already formatted**, which is the load-bearing decision.
Several notifications render a time in the *recipient's* own zone — meeting
reminders, task deadlines and interview assignments all look up `tzByUser` — and a
template can never know that. So the boundary is: the call site owns the data and
how it reads; the template owns the words and their order.

**Keyed per message, not per event type.** `meeting.cancelled` says three
different things (this occurrence, the whole series, you were removed),
`education.decision` says five, `pagedoc.mention` four. One template per event
type would have forced those to share a sentence or left the extras hardcoded.
58 messages across 39 event types.

**One edit changes the in-app row and the email together**, because `notify()`
renders both from the same template; the digest, built from `Notification` rows,
follows for free. An explicit `title`/`body` from the caller still wins, which is
what keeps announcements authored per send and the per-recipient messages
(staffing, interview assignments, mentorship nudges) working. All 58 are
`whenMissing: "default"`, so they are opt-in: an untouched notification keeps
today's wording byte-for-byte.

Four lookup tables of copy are gone, their words now editable: `STATUS_COPY`
(education decisions), `REMINDER_COPY` (onboarding), and the two `openInvite`
config entries (hiring). The onboarding reminder's three channels — in-app, email
and Slack — now read one template, so they cannot say different things.

**Verification:** 5,753 tests passing in 574 files,
`tsc` clean, `npm run build` passes. The migration was applied to a throwaway
Postgres from scratch, drift-checked with CI's own
`prisma migrate diff --from-migrations --to-schema`, and exercised with a carry
test that seeded both old slot tables (including the colliding `decision:Rejected`)
and confirmed all rows landed on the right keys.

> **13 pre-existing `tsc` errors are unrelated to this branch** and were present
> on `staging` before it: a stale `scripts/applicant-timeline.ts`, a seed
> referencing a dropped `emailSent` field, and two component prop mismatches.
> None are in files this branch touches. Worth a separate cleanup.

> Companion to [transactional-email-consolidation.md](transactional-email-consolidation.md) (BUILT, PR #1368), which
> moved every send onto the `OutboundMessage` outbox and **deliberately left rendering alone**: *"features keep
> owning rendering."* This doc is that deferred half. Also closes G4/G5/G7 from
> [TEMPLATES_AUDIT.md](TEMPLATES_AUDIT.md).

---

## 0. Verified current state

Counts below are grep-verified in this worktree, not estimated.

| Fact | Value |
|---|---|
| Gmail transports | **2** — `app/lib/gmail.ts:204` (transactional) and `app/email/lib/gmail-mailbox.server.ts:312` (Mail client, unfenced) |
| `sendEmail()` production call sites | **1** — `app/lib/outbound.server.ts:286` |
| `enqueueOutbound()` call sites | **40**, of which **34** are `channel: "email"`, across **22 files** |
| Distinct feature emails | **37** |
| Operator-editable today | **18** (14 `HiringEmail` slots + 4 `EducationEmail` slots) |
| Needs a code deploy to change a word | **19** — every partner email, every portal-student education email, all 3 auth emails, signing receipts, the onboarding block, all 38 `notify()` event types, both digests |
| Distinct HTML "shells" | **4**, plus a no-shell family |
| Emails with `<html>`/`<head>`/doctype | **0** |
| Emails with a `text/plain` alternative | only those carrying ICS or an attachment |
| `List-Unsubscribe` | none |

### What is already good (do not rebuild)

- **The outbox.** `app/lib/outbound.server.ts` — dedup keys, 6-attempt exponential backoff, dead-letter to Admin →
  Communications, per-sender daily caps, CAS-leased drain job. Solid.
- **The merge-variable engine.** `app/lib/template-variables.ts` — a registry with per-token `description` +
  `contexts`, a strict `{{token}}` grammar, `extractPlaceholders`, and an `interpolateVars` that uses
  `hasOwnProperty` + function-form replacement so `$&` in a value is safe. This is already the Postmark/Mustache
  model minus sections. Keep it and extend it.
- **`sanitizeRichEmailHtml`** (`app/lib/email.ts:67`) — allows 18 formatting tags, restricts `href` to
  `https?:|mailto:`, force-injects `target="_blank" rel="noopener noreferrer nofollow"`. Already correct, already
  built, and **only `notify()` uses it**.
- **Sender identities.** `GmailIntegration` + 4 purposes, encrypted tokens, soft-disable, daily caps.

### The three template stores, one of which is dead

| Store | Read by sends | Versions | Preview | Test send | MCP write |
|---|---|---|---|---|---|
| `EmailTemplate` + `EmailTemplateVersion` | **0 of 34** | yes | yes | yes | yes |
| `HiringEmail` (slot PK) | **17** | no | no | no | **none** |
| `EducationEmail` (slot PK) | 1 | no | partial | no | via the wrong tool |

Two migrations moved every real consumer off the versioned library onto slot tables
(`20260919180000_shared_hiring_emails`, `20260921120000_education_emails_untemplated`), and
`app/lib/drive.server.ts:799-804` says so outright. The net result:

> **The store you can preview and test-send cannot send. The stores that send cannot be previewed or test-sent.**

`list_email_templates` / `manage_email_template` operate on a store that cannot affect a single real outbound email.

That direction was right — per-cycle binding was overhead nobody wanted. What got lost was versioning, preview, and
test-send. This plan keeps the slot model and restores those three.

---

## 1. Phase 0 — defects to fix first, independent of any redesign

These are not style issues. Each is its own small PR, no feature flag, shippable this week.

### 0.1 Live credentials retained in the DB for 6 months 🔴

`app/lib/betterauth.server.ts:182` and `:221` put the secret in the dedup key:

```ts
dedupKey: `auth.magic_link:${email}:${url}`   // the full one-time sign-in URL
dedupKey: `auth.email_otp:${email}:${otp}`    // the plaintext 6-digit code
```

`app/jobs/retention-janitor.server.ts:47-54` nulls `bodyHtml`/`bodyText`/`slackText`/`ics`/`attachments` at 24h.
**`dedupKey` is not in that list**, and `Sent` rows are not deleted until `retentionMonths` (default **6**,
`app/jobs/registry.ts:261`). So plaintext sign-in codes and complete one-time sign-in URLs persist in Postgres, in
every Neon branch cut from it, and in every backup, for half a year. Staging is rebuilt from a prod snapshot each
deploy, so they propagate.

**Fix:** the code comments at `:181` and `:220` say the only requirement is a *fresh* key per send. A nonce or a
hash satisfies that. `auth.email_otp:${email}:${randomUUID()}`. Land this before the `betterauth` flag flips.

### 0.2 `POST /api/email/send` is ungated 🔴

`app/routes/api.email.send.ts:18` is `requireAuth` with **no role check**, and sends caller-supplied raw HTML, with
no sanitization, to an arbitrary address, as `purpose: "Hiring"` — i.e. from `applications@dali.dartmouth.edu`. Any
authenticated account can send arbitrary styled mail as the lab's admissions address. Mitigations that exist:
100/min per-user rate limit, audit log, outbox row.

**Fix:** gate to `isCore`, and run the body through `sanitizeRichEmailHtml`.

### 0.3 Hardcoded 2026 dates in a live email 🟠

`app/members/lib/welcome.server.ts:299-303` hardcodes `"June 8th, 2026"`, `"Sunday, September 13th"`, `26F`, and the
signature `"Sean Noh and DALI Hiring"`. It is appended to **every** acceptance email
(`api.decisions.$id.release.ts:206`, `waitlist.server.ts:427`), so as of today it is shipping stale dates. It also
reads `process.env.FRONTEND_URL` directly instead of `getFrontendUrl()`, so its login link and logo break on PR
preview apps.

**Fix:** move the dates to cycle fields or a template, use `getFrontendUrl()`. This is the single highest-value
editability target in the audit: a lead can rewrite the entire acceptance letter in the UI but cannot touch the half
of it carrying the actual deadlines and the signer's name.

### 0.4 The Mail client is a second, unfenced transport 🟠

`app/email/lib/gmail-mailbox.server.ts` has **zero** `getAppEnv()` guards. No dev-skip, no staging redirect, no
outbox row, no retry. **Staging will send real mail to real recipients from it.** Human-composed mail, so out of
scope for templating, but it needs the same env fence.

### 0.5 Double redirect and two banners in staging 🟡

`resolveCandidateEmail()` redirects applicant mail to `TEST_INBOX` and prepends a yellow banner; then `gmail.ts:237`
overwrites `To:` with `systems@` and prepends a *second*, differently-bordered banner (`#ffe69c` vs `#ffeeba`). Pick
one layer. The transport is the right one.

### 0.6 Unescaped interpolation into HTML 🟡

`renderNotificationEmail` does not escape `firstName`/`title`/`linkLabel`/`href` (`notify.server.ts:90-91`);
`renderDigestEmail` escapes nothing (`notification-digest.server.ts:120-136`); every partner email splices
`nextSteps`/`reason`/`orgName`/`contactName` raw (`partner-emails.server.ts:53`, `invites.server.ts:98`).
Values are mostly internal today, but partner org names and contact names are partner-controlled. Education is the
only surface that escapes consistently.

**Fix:** see §3.4 — make escaping the default in the interpolator rather than a convention.

### 0.7 Copy bugs worth fixing while in here 🟡

- **Waitlist promotion reads as a first-round acceptance.** `sendDecisionEmail` keys on `status`, not `promoted`
  (`education/lib/notifications.server.ts:382`), so the "a seat opened up" wording exists for the in-app row only.
- **One OTP body serves four semantic types.** `sendVerificationOTP` is wired to `sign-in`,
  `email-verification`, `forget-password` and `change-email`, and renders "Your DALI OS sign-in code is:" for all
  four. A password-reset code arrives mislabeled.
- **Expiry copy contradicts the TTLs.** The verification email states no expiry (actual 1h, an unset BetterAuth
  default); the magic link says "expires shortly" (actual **5 minutes**). The two emails whose TTL is a named
  constant — the legacy partner link and invite — are accurate. Generalize that: derive the human string from the
  constant. Also set `magicLink({ expiresIn })` and `emailVerification.expiresIn` explicitly.
- **No partner-application-received confirmation exists.** `partner.apply.tsx:140` notifies the form creator, not
  the applicant. Submitting the partner form emails the applicant nothing.
- **Subject and CTA are swapped** between the two "here's your sign-in link" emails, and both stay live after
  cutover because `partners.$orgId.tsx:314` is unflagged.

---

## 2. Package research — verdict

**Recommended new runtime dependencies: 1** (`html-to-text`). The repo already owns the hard parts (outbox, variable
registry, sanitizers). What is missing is a layout and an editor surface, and neither needs a framework.

Two build facts make this cheaper than expected:

- **Headless Chromium and `playwright-core` are already production dependencies.** The Dockerfile does
  `apk add chromium`, sets `CHROMIUM_EXECUTABLE_PATH`, and `playwright-core@^1.62.1` is in `dependencies` for
  `app/lib/pdf/render.server.ts`. So server-side rendering of email HTML to an image — admin preview thumbnails,
  real colour-contrast checking — costs **zero new dependencies**. Strongest reuse lever available.
- **The runtime Docker stage runs `npm ci --omit=dev`**, so devDependency tooling is excluded from the production
  image by construction. MJML-as-a-devDependency is clean, provided nothing in `app/` ever imports it.

| Option | Verdict | Why |
|---|---|---|
| **MJML 5.x as a design-time tool** | ✅ **adopt, devDependency only** | Author the layout once in `.mjml`, commit the compiled HTML. Gets ghost tables, MSO conditionals, inline-by-construction layout CSS. Zero runtime dep, zero per-send cost. (Runtime use costs only ~1.2ms if we ever want it, but then operators must learn MJML, which fights the goal.) **5.x only** — 4.x is unpatched for CVE-2025-67898. |
| **`mustache@4.2.0`** | ⏸️ **only if conditionals are needed** | 113 KB, **0 dependencies**, same `{{token}}` grammar we already use, logic-less so no SSTI surface, escapes by default. Literally what Postmark uses. Add it the first time an operator needs "show this paragraph only if there's a meeting link." Not before. |
| **`html-to-text@10.0.1`** | ✅ **adopt** | MIT, 21.3M/wk, Node ≥20.19. Supplies the missing `text/plain` part **and** lets us delete *both* hand-rolled strippers (`app/lib/email.ts:100` truncates at 2000 chars and bullets `<li>`; `app/lib/gmail.ts:34` uses different rules and an iterative tag-strip). One change that is simultaneously the accessibility fix, the `MIME_HTML_ONLY` spam fix and a DRY fix. Configure `selectors` to skip the preheader. |
| **`juice@12.2.0`** or `@css-inline/css-inline` | ⏸️ **probably not needed** | Only if the body stylesheet grows. For 19 allowed tags, a tag→inline-style map is ~30 lines and zero deps. Start there. Note `juice` requires Node ≥22.12.0; `@css-inline/css-inline` is the better artifact (2.5 MB vs 12 MB, musl prebuilts for our Alpine image) but needs `{ keepAtRules: true, loadRemoteStylesheets: false }`. |
| **`react-email` as a runtime dep** | ❌ | 22 runtime deps including esbuild, socket.io, tailwindcss, prismjs, chokidar. `@react-email/components`, `@react-email/tailwind` and `@react-email/preview-server` are all **deprecated on npm** as of 6.0.0. `@react-email/render@2.1.0` alone is viable (190 KB) but pulls `prettier` into production, and React authoring improves the layout we write *once* while doing nothing for operator editability. |
| **Novu / Knock / Courier** | ❌ | We already own the event registry, 3-channel preference matching, digest grouping and an idempotent outbox. Novu self-host is **Redis + MongoDB 8 + 4 services** in a deliberately Redis-free, Postgres-only app, and is open-*core*. Knock/Courier are SaaS: moving member PII and the in-app feed off our Postgres and paying per message to fix "we have no shared layout." Steal the patterns, not the stack. |
| **Maizzle** | ❌ | 232 MB / 501 packages, Vue SFC authoring, 170-470 ms per render. |
| **Handlebars / Nunjucks / EJS / Eta** | ❌ | Nunjucks' and Eta's own docs say they are unsafe for user-defined templates; Handlebars has a CVSS 9.8 RCE in its history and compiles to JS. We do not need an expression language to let someone edit a sentence. |
| **GrapesJS, Unlayer, `@maily-to/*`, `@react-email/editor`** | ❌ | Respectively: newsletter preset last published 2023; embeds a hosted editor needing an account and $250/mo for custom JS; no `license` field published and depends on deprecated packages; pins Tiptap 3 in new code against CLAUDE.md. |

### Email-client constraints the layout must respect (2026)

- **Tables, still.** Classic Outlook for Windows is the Word engine: no flex, no grid, no `border-radius`, no `rem`,
  no `@media`, `max-width` only on `<table>`. Microsoft's own availability guide says classic "will continue to be
  supported until **at least 2029**," currently opt-in with new Outlook off by default. Do **not** plan around "the
  Word engine dies October 2026" — that is Office LTSC 2021 EOS, not an Outlook cutover. EDU is exactly where
  classic persists, so our real exposure is higher than Litmus's 5.83% desktop-Outlook open share suggests.
  A single-column transactional email needs neither flex nor grid, so we lose nothing.
- **Dark mode cannot be opted out of.** Ship both `<meta name="color-scheme">` and `supported-color-schemes` plus
  `:root { color-scheme: light dark }`. Treat `prefers-color-scheme` (~42%, and **Gmail does not support it on any
  of its 4 clients**) as progressive enhancement. Avoid literal `#ffffff`/`#000000` (use `#fffffe`/`#000001`);
  avoid mid-tones, which go muddy; underline links so color is not the only signal; never put live text over a
  background image. Outlook.com rewrites low-contrast colors and stashes originals in `data-ogsc`, so target
  `[data-ogsc]` and exclude Outlook from the `prefers-color-scheme` block via `:not([class^="x_"])`.
  **QA gate is two transforms, not ten clients:** Gmail iOS (full invert) and Outlook.com (partial).
- **Logos.** A transparent PNG with dark ink disappears on an inverted background and is not inverted with it. Bake
  an opaque plate behind the mark. `<picture>` swaps are not viable (24% support; Gmail replaces `<picture>` with
  `<u></u>`) — use a CSS `display` swap.
- **No web fonts** (24% support; classic Outlook falls back to Times New Roman). System font stack.
- **`role="presentation"`** on every layout table, `lang` on `<html>`, real `<h1>`-`<h6>` (100% support), alt text.

---

## 3. The design

Four layers. Each is independently shippable and independently useful.

### 3.1 Layer 1 — one code-owned layout

New `app/email/lib/layout.server.ts`:

```ts
renderEmail(args: {
  templateKey: EmailTemplateKey;
  vars: Record<string, string>;
  bodyHtml: string;          // operator-authored, already sanitized
  preheader?: string;
  cta?: { href: string; label: string };
  footer?: "notifications" | "transactional" | "none";
}): { subject: string; html: string; text: string }
```

The layout is a plain template string authored from a committed `.mjml` source: doctype, `<html lang="en" dir="ltr">`,
the `color-scheme` meta pair, a small `<style>` holding only `@media` + `[data-ogsc]` rules, hidden preheader +
spacer, single-column fluid-hybrid table at 600px with MSO ghost tables, `role="presentation"` throughout, inline
styles on everything else, system font stack, and a footer slot.

**One shell, three footer variants** (not four shells): `notifications` carries the settings link, `transactional`
does not (a decision letter must not look unsubscribable), `none` for the credential handoff.

**Copy conventions**, per Kiran's house style — plain, direct, no em dashes, lead with the fact:

- Footer: `DALI OS · notification settings` (middot, not an em dash). Today's `— DALI OS` and
  `— DALI Education` both go.
- Subjects: one convention. `<Thing>: <specifics>` for events, plain sentence otherwise. Today there are six
  competing conventions and "DALI" / "DALI OS" / "DALI Lab" / "the DALI Lab" are used interchangeably.
- One greeting, escaped once, in the shell. Today there are five variants and two escape policies.
- One button style. Today: navy pill radius 8, black pill radius 6, bare link, and a raw pasted URL.

### 3.2 Layer 2 — a template registry, generalizing the hiring refactor

**Decided:** apply the pattern the hiring refactor already landed, lab-wide. That refactor got the shape right —
slot as the primary key, one shared row per slot edited in place, the slot vocabulary and its per-slot variable
contract declared in code, a soft lint that warns but never blocks. What it lacked was versioning, preview and
test-send. This generalizes the former and restores the latter.

New `app/email/lib/registry.ts`, shaped like `app/jobs/registry.ts` and `app/lib/notification-events.ts` so it
reads as house style, and carrying forward `app/hiring/lib/email-variables.ts`'s per-slot variable table:

```ts
EMAIL_TEMPLATES = {
  "hiring.decision.accepted": {
    area: "Hiring",
    label: "Decision: accepted",
    description: "Sent when a lead releases an Accepted decision.",
    purpose: "Hiring",
    variables: ["firstName", "domain"],   // the intersection every call path fills
    sample: { firstName: "Alex", domain: "Engineering" },
    footer: "transactional",
    whenMissing: "skip",                  // no row = send nothing (hiring's rule)
  },
  "meeting.invite": {
    area: "Meetings",
    purpose: "General",
    variables: ["firstName", "title", "time"],
    footer: "notifications",
    whenMissing: "default",               // no row = use `defaults` below
    defaults: { subject: "Meeting invite: {{title}}", body: "..." },
  },
  ...
}
```

One entry per email. The registry owns **structure** (which variables exist, which sender purpose, which footer,
whether absence is fatal); the DB row owns **words**.

**One deliberate divergence from hiring.** In hiring, a missing row means that slot sends nothing, which is correct
there — a lead who hasn't written a rejection letter should not have one invented. That rule is unsafe for
`notify()`, where an operator clearing a row would silently switch off a channel members rely on. Hence
`whenMissing`: `"skip"` keeps hiring's exact semantics, `"default"` falls back to registry copy. Every
`notify()`-backed template uses `"default"`, so the registry entry is a live fallback, not just a seed.

Carry over verbatim from hiring: `variables` is the **intersection** of what all call paths populate (the
`email-variables.ts:52-56` rule), the soft lint distinguishing `unknown` tokens from `unfilled` ones, and the test
that pins each registry entry against the keys its call sites actually pass so drift fails CI loudly.

### 3.5 notify() under the same pattern

Today **38 event types share one hardcoded shell** (`notify.server.ts:68`) and none of it is editable. Each gets a
registry key with `whenMissing: "default"`, so operators can edit any event's subject and body, and the greeting,
footer and button label become editable once rather than 38 times. No call site changes: `notify()` already
resolves `EVENT_TYPES[eventType]`, so it resolves the template key from the same place.

Per-event titles stay as the `defaults` in the registry, which means the 38 rows are **opt-in** — an operator
edits only what they want to change, and an untouched event keeps today's copy byte-for-byte. That keeps the
"38 rows to maintain" cost at zero until someone chooses to pay it.

### 3.3 Layer 3 — one store, one editor

**Decided: collapse three stores into one**, keyed by registry key, with versions restored:

```prisma
model EmailTemplate {
  key         String   @id      // an EMAIL_TEMPLATES key
  subject     String
  body        String
  updatedAt   DateTime @updatedAt
  updatedById String?
  versions    EmailTemplateVersion[]   // append-only, for history + rollback
}
```

- Migrate `HiringEmail` (14 rows) and `EducationEmail` (4 rows) in by mapping slot → key.
- Drop the free-floating `name` + `folderPageId` + Drive `emailTemplate` type and the binding concept. Templates are
  not documents; they are the copy for a known event. This removes the dead-library confusion rather than preserving
  it.
- **Data-losing migration** (drops `HiringEmail`, `EducationEmail`, old `EmailTemplate.name`/`folderPageId`) —
  flag in the PR description per CLAUDE.md.

**One admin surface** at `/admin/email`, replacing three: `/admin/email-templates`, the hiring Setup-tab modal buried
in a 3,900-line route, and the education manage-page modal. Grouped by registry `area`. Per template: edit, live
preview, unknown/unfilled lint (already built in hiring), "send test to me" (already built, currently only on the
dead store), version history with diff and rollback-as-new-version.

Preview specifics worth pinning now:

- **The preview iframe is an XSS boundary**, because operator copy is untrusted HTML. Use `srcdoc` with `sandbox`
  and **without** `allow-scripts` or `allow-same-origin`. The current dead-library preview uses
  `dangerouslySetInnerHTML` directly into the admin page (`EmailTemplateDetail.tsx:92`), which is only safe because
  `bodyToHtml` strips everything to `<p>`/`<br>`. Moving to `sanitizeRichEmailHtml` widens the allowlist, so the
  iframe stops being optional.
- **Light/dark toggle plus a server-side Chromium thumbnail**, reusing the Chromium and `playwright-core` already
  shipped for PDF rendering. Zero new dependencies.
- Borrow Maizzle's three preview tabs as the feature list: **Checks** (caniemail warnings), **Stats** (compiled
  size, image count, link count, warn at 51 KB / error at 100 KB), **Test** (send to me).
- Build it in-app rather than adopting react-email's preview server: that server bundles template *files* and has
  no DB connection, so for copy stored in Postgres it would be showing fiction. It can show a layout; it cannot
  show an email.

Also: **one role rule.** Today it is `isCore` / `isCore` / `isCycleAdmin(user, cycleId)` — a per-cycle role editing
copy every cycle shares. Lab-wide copy is Core.

And **one missing-row rule**, now expressed as registry `whenMissing` (§3.2). Today it is a hard 409 for hiring
decisions and a silent skip for hiring interviews and education.

**Authoring:** reuse `DocEditor` (BlockNote) rather than the current `<textarea rows={18}>`, per CLAUDE.md's
reuse-before-building rule. Server path: blocks → `blocksToHTMLLossy` → **`sanitizeRichEmailHtml`** → tag→style pass.

> Switching the editable path from `bodyToHtml` (DOMPurify-locked to `["p","br"]`, zero attributes) to
> `sanitizeRichEmailHtml` is the **single highest-leverage capability unlock in this plan**. Operators currently
> cannot author a hyperlink — a booking link has to be a bare URL relying on client autolinking. The safe sanitizer
> that allows links, bold and lists already exists and is already used by `notify()`.

### 3.4 Layer 4 — fix the MIME envelope and the interpolator

- **Add `text` to `sendEmail`.** `app/lib/gmail.ts:204` has no `text` param, so `OutboundMessage.bodyText` is written
  by producers and **dropped on the floor** unless the send carries ICS or an attachment. Always build
  `multipart/alternative`.
- **Move the staging banner.** `gmail.ts:239` does `stagingBanner(to) + html`. Harmless for fragments; the moment
  `html` starts with `<!DOCTYPE html>` it prepends a `<div>` *before* the doctype. Must inject after `<body>`.
- **Add `List-Unsubscribe` + `List-Unsubscribe-Post`** (RFC 8058) for the `notify()` and digest classes only, never
  for transactional mail.
- **Make `interpolateVars` escape by default**, with an explicit raw form for the few HTML values (Mustache's
  `{{{ }}}` convention, or a separate `interpolateHtmlVars`). Behavior change, so gate it behind tests over every
  existing body.
- **Dedupe:** 4 copies of `escapeHtml`, 2 of `htmlToPlainText`, 2 staging banners, 6 copy-pastes of the 480px div,
  2 sample-var blocks, 4 copies of the recipient-address fallback chain.
- **Per-purpose `From` display name.** `APPLICATIONS_FROM_NAME = 'DALI Lab'` (`app/lib/app-env.ts:34`) is applied to
  all four purposes, so Education and Partners mail displays as "DALI Lab". Worse, `getSender` falls back to Hiring
  for any unconnected purpose, so member notifications and partner invites can go out from `applications@`.

---

## 4. Rollout

Flagged `email-layout` per CLAUDE.md. Each step independently shippable; volume-weighted so the biggest surfaces get
the new shell earliest.

| # | Step | Surfaces | Why here |
|---|---|---|---|
| **0** | §1 defects | — | No flag, no redesign dependency. Ship first. 0.1 must precede the `betterauth` flip. |
| **1** | Layout + `renderEmail()` + MIME envelope (§3.1, §3.4) | none yet | Pure addition behind the flag. Golden-file tests. |
| **2** | `notify()` + digest | **38 event types + 2 digests** | One call site each (`notify.server.ts:335`, `notification-digest.server.ts:219`). Largest share of volume for the least code. |
| **3** | Auth | 3 emails | Pure find-replace of 3 `bodyHtml:` literals. Already on the outbox. |
| **4** | Registry + store collapse + `/admin/email` (§3.2, §3.3) | 18 existing slots | The data-losing migration. Hiring and education keep working throughout. |
| **5** | Partners + signing + education-hardcoded | 15 emails | Brings the 19 non-editable emails under the registry. |
| **6** | Gaps (§0.7) | partner confirmation, promotion copy, expiry-from-constant | Needs the registry in place. |

### Test strategy

House style is exact-string assertions on pure functions; the repo has **zero** snapshot tests across ~4,400 tests.
Keep it that way. There is now empirical support for that instinct: a *patch* bump of a transitive dep
(tailwindcss 4.3.2 → 4.3.3) silently changed react-email's output, and Vitest fails CI on obsolete snapshots, so
renaming a test turns CI red.

**Tier 1 — plain Vitest, no containers, no browser. All of this is gateable.**

1. **Add the `text/plain` part and delete both hand-rolled strippers** (§3.4). Assert each template yields a
   non-empty text part containing the bare CTA URL with no angle-bracket residue. Highest value per unit of effort
   in the whole plan.
2. **~15 `cheerio` assertions per template** in one shared helper (works in the default `node` environment, no
   config change): CTA `href` is absolute `https`, no `http:` anywhere, `alt` on every `<img>`, preheader present,
   `role="presentation"` on every layout table, `dir` and `lang` on `<body>`, `lang` on `<html>`, a `<title>`, no
   `<script>`/`<form>`. **The three most common email a11y failures in the industry — missing `dir` (97%), missing
   body `lang` (96%), layout tables missing `role` (84%) — have no axe-core rule and no off-the-shelf checker.**
   Each is a one-line selector here.
3. **Gmail clipping budget**: `Buffer.byteLength(html, "utf8") < 102_400`, warn at ~80 KB. Exercise it with both the
   **shortest and the longest realistic operator copy**, seeded in Postgres — otherwise the gate tests fiction, and
   an operator pasting a long block is exactly how it breaks in production.
4. **`html-validate@11.16.1`** with the `html-validate:a11y` preset (not `recommended`/`standard`, which flag the
   obsolete presentational attributes every HTML email needs). It ships Vitest matchers requiring Vitest ≥4.1.3,
   which is exactly our version.
5. **Per-step parity**: old body and new body carry the same links and the same `{{tokens}}`.
6. **`interpolateVars` escapes**, with an explicit raw-path case.
7. **No registry rot**: every `EMAIL_TEMPLATES` key has a reachable producer, and every `whenMissing: "skip"` entry
   has a seeded row. This is the test that would have caught the dead library.

**Tier 2 — infrastructure, still deterministic.**

8. **`@axe-core/playwright`** against `page.setContent(renderedHtml)`. Covers 7 of the top-10 field failures and is
   the only way to get real colour contrast. Note `page-has-heading-one` and `heading-order` are best-practice
   tagged, so do **not** filter to `wcag2a`/`wcag2aa` only.
9. **One end-to-end send through the real pipeline** — the only thing that catches MIME-shape, encoding and
   missing-plaintext bugs. ⚠️ **Blocker to resolve first: there is no SMTP path in the app.** `sendEmail` builds
   RFC822 by hand and POSTs base64url to the Gmail REST API. Capturing mail locally means either branching on a
   `MAILPIT_URL` env var and POSTing structured JSON (zero deps, but Mailpit re-composes the MIME so we stop
   exercising `makeRawEmail`'s exact multipart structure), or speaking SMTP to Mailpit, which needs `nodemailer`.
   Either way the `env === "dev"` early return becomes "if `MAILPIT_URL` is set, send there, else skip" so the
   dev-safety guarantee survives when Mailpit isn't running. Worth deferring until Tier 1 is in.

**One golden file, for the layout shell only**, so a shell change is a deliberate single-file diff.

**Explicitly do not gate on:** any absolute SpamAssassin or Rspamd score (our CI `.eml` has no `Received:` chain, no
DKIM, no real envelope sender — SPF/DKIM are Google's and don't exist where CI holds the bytes, so the score is
systematically worse than what actually ships, and daily rule updates change it with no code change; assert on
specific rule names like `MIME_HTML_ONLY` instead); Playwright pixel diffs as a proxy for client rendering;
link-checking over tokenized one-time URLs.

**Keep manual, once per layout change:** classic Outlook for Windows, Gmail web CSS stripping, dark-mode inversion
in Outlook.com and Gmail iOS, font fallback, and real inbox placement. Note the wallet-pass navy `#0C2C47` is
exactly the kind of saturated mid-dark value these transforms mangle.

**Cross-client verification is a project cost, not a subscription.** We are standardizing to one layout, so buy one
month of Mailgun Inspect (Email on Acid, $99, API included on the entry tier), burn it on the layout across
light/dark and short/long copy, cancel. Litmus is ruled out: now Validity, pricing sales-gated, API access granted
case-by-case. Parcel's free tier is a useful authoring scratchpad but has no CLI or public API, so it cannot lint in
CI. Our real audience is about five clients, not a hundred.

**Out of scope:** the Mail client (`app/email/`) as a templating surface — it is human-composed mail. It gets only
the env fence from §0.4. Retiring `CycleNotificationSend` / `SignRequestNotification` stays deferred per
`transactional-email-consolidation.md` §2.2.

---

## 5. Decisions taken (2026-10-01, with Kiran)

1. **Collapse to one store.** One data-losing migration, flagged in the PR. Three stores was the actual problem, and
   leaving the dead library in place would preserve the confusion that caused this.
2. **Generalize the hiring refactor** rather than inventing a shape: slot as PK, one shared row per slot edited in
   place, slot vocabulary and per-slot variable contract in code, soft lint that never blocks. Add back the
   versioning, preview and test-send that refactor dropped. One divergence, `whenMissing` (§3.2), so clearing a
   `notify()` row can't silently switch off a channel.
3. **Nothing is implemented until this plan is approved.** Phase 0 included — sequencing gets decided in one pass.

## 6. Still open

1. **`List-Unsubscribe` was not added.** It needs a real unsubscribe endpoint, and the mapping is a product
   decision: does one-click set that event's `digestFrequency: "Off"`, or flip a global switch? Everything else in
   §3.4 landed. Worth doing before the flag flips, since it is the one deliverability item still outstanding.
3. **The new partner-application confirmation needs a copy review.** It is new outbound mail to partners, written in
   the existing partner voice but unreviewed. Read it before the flag flips.
4. **The onboarding block's hardcoded dates are hoisted, not fixed.** `ONBOARDING_DEADLINE` and
   `REQUIRED_EVENT_DAY` in `app/members/lib/welcome.server.ts` are now named constants at the top of the file
   rather than buried in markup, so the staleness is visible — but `"June 8th, 2026"` is still what ships, and it
   is past. Needs either real values or the cycle-fields change from open question (b) below.
5. **Cycle fields vs template variables for those dates.** Leaning cycle fields, since "deadline to accept" is
   cycle data other surfaces will want.
6. **Whether `mustache` ever lands.** Not needed for interpolation. The trigger is the first real request for
   "show this paragraph only if there's a meeting link". Worth waiting for.

## 7. Before the flag flips

- Read the new partner confirmation copy.
- Turn `email-layout` on in staging and look at two transforms, not ten clients: **Gmail iOS** (full inversion) and
  **Outlook.com** (partial). Then classic Outlook for Windows, which is the Word engine.
- Check one email of each footer variant (`notifications`, `transactional`, `none`).
- Open `/admin/email` and confirm all 77 templates list, grouped by area, and that an edit to a notification
  template changes both the in-app row and the email.
- Confirm the plain-text part on a sign-in code and on a digest. (Transactional mail gets no such header either way.)
2. **Does Phase 0.3 move the onboarding dates to cycle fields or to template variables?** Cycle fields are more
   structured and validate; template variables are faster and keep it in one editable place. Leaning cycle fields,
   since "deadline to accept" is cycle data that other surfaces will want.
3. **Whether `mustache` ever lands.** Not needed for interpolation. The trigger is the first real request for
   "show this paragraph only if there's a meeting link" or "list each interviewer." Worth waiting for.
