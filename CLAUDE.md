# CLAUDE.md

Project conventions for Claude working on this repo, locally or in the `claude.yml` CI workflow.

## Stack

- **App**: `dali-api/` — React Router 7 (full-stack), TypeScript, React 19.
- **DB**: Postgres 16 via Prisma 7 ORM. Hosted on Neon (serverless). Adapters: `@prisma/adapter-neon` (prod-ish), `@prisma/adapter-pg` (local).
- **Realtime collab**: Hocuspocus server + Yjs CRDT + BlockNote editor (one shared `<DocEditor>` in `dali-api/app/components/doc/`, capability presets in `features.ts`). Legacy TipTap-era content converts lazily on load (`app/collab/persistence.ts`); server reads go through `app/collab/read.ts`.
- **AI (docs)**: BlockNote writing assistant at `POST /api/ai/doc` — provider from `ANTHROPIC_API_KEY` (first-party) or `DARTMOUTH_CHAT_API_KEY` (Dartmouth Chat gateway, same Anthropic SDK via `resolveAiProvider()` in `app/lib/ai.server.ts`; `AI_PROVIDER` forces one). Models come from the registry in that file: add a task to `AI_TASKS` and call `modelParams(provider, task)`, never name a model at a call site; per-user rate limits (in-memory burst + Postgres `AiUsage` daily quota) with token usage on the same table (Admin → AI Usage). Surfaces opt in per-mount via the `aiEnabled` prop on `DocEditor`.
- **Redis** (`REDIS_URL`, ioredis): fans Hocuspocus updates across machines (`app/collab/server.ts`) and carries the realtime bus behind every SSE stream (`app/lib/realtime-bus.server.ts`; build SSE routes with `busEventStream` from `app/lib/sse.server.ts`, not a per-route poller). Prod has Redis, staging and local don't; without it both fall back to single-process, so cross-machine sync only shows up in prod.
- **Background jobs**: in-process 60s runner (`dali-api/app/jobs/`), cross-machine dedup via a Postgres CAS lease on `ScheduledJob` rows (no Redis). Per-job toggles/intervals/settings live in Admin → Jobs.
- **Outbound messages**: email, Slack DMs and Slack channel posts go through the outbox (`enqueueOutbound()` in `app/lib/outbound.server.ts`), drained by a job, with dedup keys built in `app/lib/outbound-keys.ts` (never put a credential or one-time URL in a key; keys outlive message bodies). Don't call `sendEmail` (`app/lib/gmail.ts`) or the Slack client directly from feature code.
- **Notifications**: three channels (in-app, email/digest, Slack DM) dispatched by `notify()` per user preference, which enqueues email and Slack through the outbox — see "Background jobs & notifications" below. The desktop app layers native banners on the in-app feed: gated per event by the `desktop` sub-preference and flagged urgent via registry `timeSensitive`, resolved at feed-read time (`/api/notifications`), with `/api/notifications/stream` (SSE) for live delivery.
- **Auth**: Google OAuth, Dartmouth CAS, all on BetterAuth (`app/lib/betterauth.server.ts`). `requireAuth` (`app/lib/auth.ts`) still accepts legacy opaque session ids (`__dali_sid` cookie or Bearer, `app/lib/session.ts`) first, then BetterAuth, until the last legacy session expires (`specs/betterauth-legacy-auth-cleanup.md`). New auth code targets BetterAuth only.
- **MCP server**: `/mcp` (`app/routes/mcp.ts`), OAuth-scoped `mcp:read` / `mcp:write` / `mcp:admin`. New tools go in `app/mcp/tools/` as an `McpTool` and get spread into `REGISTRY_TOOLS` in `app/mcp/registry.ts`, the only list the route dispatches from. Tools enforce the same role checks as the web routes (reuse `app/mcp/tools/access.ts` and `app/lib/roles`), and writes need `mcp:write`.
- **Public API**: `api/public/*` (`app/public-api/`) serves dali.website server-to-server behind a shared secret that fails closed. It returns a deliberately narrow projection; never widen it to raw models.
- **Styling**: Tailwind CSS 4.
- **Deploy**: Fly.io. Branches: `staging` → `prod`. Migrations require `DIRECT_URL` (non-pooled Neon endpoint) in addition to pooled `DATABASE_URL` — see `dali-api/prisma/MIGRATIONS.md`.
- **Package manager**: npm. Node 22.
- **Other packages**: `asr/` (Modal transcription service, Python + uv, deployed by `deploy-asr.yml`), `ios/` (SwiftUI iPad room display), `mobile/` (Expo React Native member app for iOS and Android; reads `/api/mobile/*` and records meeting notes through `/api/meeting-recordings/*`; needs a dev build, not Expo Go), `jobx-extension/` (Chrome timesheet extension). Each has its own README.

## Commands (run from `dali-api/`)

| Task | Command |
|---|---|
| Install deps | `npm install` |
| Unit tests | `npm test` (Vitest) |
| Coverage | `npm run test:coverage` (V8 provider; writes `coverage/`) |
| Integration tests | `DATABASE_URL=<throwaway local db> npm run test:integration` (real Postgres; migrates, then truncates every table between tests; refuses non-local hosts) |
| E2E tests | `npm run test:e2e` (Playwright — needs seeded Postgres) |
| Demo videos | `npx playwright test -c playwright.demos.config.ts demos/<name>.demo.ts`, then `npx tsx demos/lib/encode.ts` |
| Typecheck | `npm run typecheck` (runs `react-router typegen && tsc`) |
| Build | `npm run build` |
| Dev server | `npm run dev` |
| Seed DB (dangerous, local only) | `npm run db:reset:local` |

No ESLint/Prettier script is wired up today — don't invent lint commands.

## Local dev

- Postgres: `docker compose up db` from the repo root (Postgres 16, `dali:dali@localhost:5432/dali`, the URL `db:reset:local` uses). `docker compose up` also runs the API in a container on 3001 with collab on 3002.
- In a fresh checkout or worktree, run `npx prisma generate` before anything else; tests, typecheck and the dev server all import `app/generated/`.
- No Redis locally is normal: collab and SSE run single-process (see Stack). Set `REDIS_URL` only to test cross-machine fan-out.
- Use Node 22. Newer local Node (25) differs from CI and Fly in ICU/`Intl` output and breaks jsdom's `localStorage` (run with `NODE_OPTIONS=--no-experimental-webstorage`).

## Test gotchas

- The CI unit job runs **without** a generated Prisma client. Never `vi.importActual` (or otherwise really import) a module chain that reaches `app/generated/prisma`; mock `~/lib/db.server` instead. Check a new test by running it with `app/generated` moved aside.
- From `app/generated/prisma`, use `import type` only. A value import pulls the Prisma runtime into the client bundle and into unit tests.
- Client-reachable modules must not import `node:*` builtins, even unused; a dead import crashes the client bundle. Server-only code goes in `*.server.ts`.

## Reading live data

The DALI OS MCP server (the `dalios` tools, when connected) reads real staging/prod data as the signed-in user. Use it as needed to check how data actually looks before modeling a change, reproduce a reported bug, or confirm a fix. Read tools are fine to call freely; write tools change real records, so confirm with the user first.

## Branching & PRs

- PRs target `staging`, not `prod`.
- `prod` deploys come from staged promotion (`promote-to-prod.yml`), not direct merges.
- Branches created by the `claude.yml` issue workflow use `claude/issue-<N>` (the auto-merge and CI-fix workflows key on that prefix). Local sessions use descriptive prefixes (`fix/`, `feat/`, `chore/`, `docs/`).

## CI workflows

These live in `.github/workflows/`. Gating on PRs (treat failures as blocking):
- `test.yml` — Vitest unit tests (Prisma mocked), Vitest integration tests (`*.integration.test.ts`, real Postgres), and Playwright E2E against a real Postgres service container. Use an integration test when the behavior depends on the database itself: raw SQL, transactions, unique constraints, cascades, locking. The unit job also reports V8 coverage to the run summary and uploads the HTML report as the `coverage-report` artifact; coverage is reported, not gated.
- `build-check.yml` — Docker build validation via flyctl. The build runs `react-router build`, not `tsc`, so **no CI job typechecks**; run `npm run typecheck` yourself when you touch TS.
- `migration-check.yml` — Prisma migration safety: no schema drift, no deleted applied migrations, pgfence safety analysis.
- `codeql.yml` — static security scanning.
- `preview-deploy.yml` — per-PR Neon branch + Fly app (don't worry about this one unless it's failing specifically). `preview-teardown.yml` and `preview-sweeper.yml` clean them up.

Deploy and release:
- `deploy.yml` — Fly deploy on push to `staging` or `prod`.
- `promote-to-prod.yml` — promotes `staging` to `prod`.
- `deploy-asr.yml`, `desktop-release.yml`, `mobile-release.yml` — the ASR service, desktop app, and mobile app (EAS build or OTA update on `prod`).

Automation:
- `demo-capture.yml`, `demo-write.yml` — demo videos for release notes (see Release notes).
- `sync-lockfiles.yml` — regenerates lockfiles when `dali-api/package.json` changes.
- `claude.yml`, `claude-ci-fix.yml`, `claude-auto-merge.yml` — the issue-to-PR Claude workflow. Rarely used now.

## Migration rules

- **Never hand-edit an applied migration file.** If schema needs to change, add a new migration.
- **Never delete an applied migration file.** `migration-check.yml` enforces both of these.
- Data-losing migrations (drops, non-null without default on populated columns, etc.) should be flagged in the PR description rather than pushed quietly.
- If `migration-check` fails, read its output — it names the offending migration.

## Auth & data handling

- Do not log auth tokens, JWTs, OAuth codes, session cookies, or CAS tickets.
- Do not echo secrets (`DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `ANTHROPIC_API_KEY`, `DARTMOUTH_CHAT_API_KEY`, `SLACK_*` / `GMAIL_*` / `GOOGLE_*` credentials, `SHOWCASE_API_SECRET`, or anything from `dali-api/.env*`) into PR comments, issue comments, or workflow output.
- Don't add routes (or MCP tools) that return the full user table or bypass role checks.

## External API consumers

Some routes serve clients you can't hot-fix. Changes to them must be additive (new fields and routes are fine; never rename, remove or change the shape of existing ones), and the PR description must say which client is affected:
- **Mobile app**: `/api/mobile/*` and `/api/meeting-recordings/*`. Builds already on phones keep calling the old shape until users update.
- **dali.website**: `api/public/*`.
- **MCP clients**: tool names and input schemas in `app/mcp/`. To rename a tool, keep the old name as a deprecated alias (a registry entry with `aliasOf`).
- **Desktop app**: see Desktop app below.

## Realtime / collab caveats

- The `@blocknote/*`, `@hocuspocus/*`, and `yjs` bits are CRDT-based. Schema changes to collaboratively edited documents need extra care — tests may pass locally but break document sync in production. Flag any such change in the PR description.
- `@tiptap/*` remains a dependency ONLY for the legacy decode layer (`dali-api/app/collab/legacy/` reads pre-BlockNote `"default"` fragments forever) — don't remove it, and don't use it for new editor work.
- Never decode a live Y.Doc server-side without cloning it first — y-prosemirror deletes content it can't decode and Hocuspocus broadcasts the deletion (`persistence.ts` enforces the clone rule).

## Background jobs & notifications

- **Adding a job**: write a handler and add one entry to `dali-api/app/jobs/registry.ts` — the DB row, admin-panel row, and tick pickup all follow. The `ScheduledJob` row is authoritative for interval/settings once created (operator-edited in Admin → Jobs); the registry only seeds defaults. Handlers must be idempotent (the lease recovers crashes by re-running) and keep per-tick work bounded well under the 5-minute lease.
- **Adding a notification type**: add one entry to `app/lib/notification-events.ts` and dispatch via `notify()` (`app/lib/notify.server.ts`) — **never write `prisma.notification` directly** for member-facing notifications; the settings page, preference matching, and digest grouping all derive from the registry. Pick defaults that preserve behavior for users with no preference rows. Renaming an `eventType` requires backfilling both `Notification` and `NotificationPreference`.
- **Outbound gating**: enqueue via `enqueueOutbound()`; the drain ends in `sendEmail`, which handles env safety itself (dev skips, staging redirects to the test inbox); Slack DMs are prod-only (`NOTIFY_SLACK_DM_OVERRIDE=1` to test). Applicant/portal/partner transactional email stays on its direct per-feature pipelines, outside the preference layer.
- Manual trigger: `POST /internal/jobs/tick` (`x-jobs-secret` header or an Admin session), or Run-now in Admin → Jobs. Digest jobs self-gate on wall clock — Run-now outside the send window is a no-op by design.
- **Feature flags**: gate new/in-progress features behind a flag, not an ad-hoc boolean. Add one entry to `app/lib/feature-flags.ts`, then check `useFeatureFlag("key")` (client) or `isFeatureEnabled(...)` (server). Targeting (everyone/role/user) is edited in Admin → Feature Flags; flags default off. `evaluateFlag` stays in the client-safe `feature-flags.ts` (not `.server`) so its test needs no Prisma client.

## Release notes

Release notes live at `/release-notes` and are authored in Core → Communications → Release notes (`ReleaseNote` model, `release-notes` flag). Spec: `specs/release-notes.md`.

- **What counts**: write for a member using the platform. New features, new capabilities, changed workflows, and removals a user relied on get an entry. Small bug fixes, copy and styling tweaks, refactors, perf work nobody perceives, tests, CI, and internal tooling do not. A fix earns an entry only if it was a known, widely felt problem.
- **When opening a PR**, release notes are opt-in: only a PR with text under the "Release note" heading in its body gets a drafted entry. If the change is user-facing by the rule above, write one plain-language line there (what a member can now do, not how it was built). Otherwise leave it empty.
- **If it's ambiguous** whether a change is user-facing, which area it belongs to, or whether it should be limited to an audience (e.g. Core only), ask the user instead of guessing. In CI, say so in the PR description.
- Release-note copy follows the UI copy rules (see UI copy & design).
- **Demos**: when opening a user-facing UI PR, add `dali-api/demos/<name>.demo.ts` (see `dali-api/demos/README.md`). `demo-capture.yml` records it and files the mp4 under `release-notes/pr-<N>/`. If a PR has a release-note line but no demo, `demo-write.yml` has Claude write one (write, record, review loop) and commits it to the PR branch.

## UI copy & design

- **Copy**: plain language, sentence case, no em dashes, no marketing. Say what a member can do, not how it was built. Applies to every user-facing string: labels, empty states, toasts, emails, release notes.
- **Design system**: `STYLE_GUIDE.md` at the repo root is the dali.os system as it lives in code (tokens in `app/app.css`, `useOsChrome()` in `app/components/os-chrome.ts`, hub-page parts in `app/components/os-page.tsx`, floating-layer dress in `ui/floating/styles.ts`). Read it before building UI. All colors are tokens (`bg-os-card`, `text-os-grey`, or semantic aliases like `bg-card`, `text-muted-foreground`); never hardcode a hex or use raw Tailwind palette colors in a component. Light mode comes free from tokens. One look everywhere; auth screens (login, signup, welcome) keep the DALI brand.
- If you change a token or a component rule, update `STYLE_GUIDE.md` and `STYLE_GUIDE.html` with it.

## Operating rules when running in CI

- **Never use `--no-verify`, `--no-gpg-sign`, or any git flag that bypasses hooks.**
- **Never force-push `staging` or `prod`.** Force-push to your own `claude/issue-*` branch is fine if needed.
- **Don't modify files under `.github/workflows/`** unless the task explicitly asks you to. CI pipeline changes are out of scope for ordinary issues.
- **Don't touch `prisma/migrations/` to "fix" a migration error.** Fix the schema or the seed instead, and regenerate a new migration.
- **When a CI failure is ambiguous or forces a real tradeoff, stop and leave a PR comment explaining the options.** Do not guess. Handing work back with a written explanation is a valid outcome.
- **When you push a fix, leave a PR comment** that summarizes what changed, keyed to the failing check or review point it addresses. Keep it short.

## Desktop app (`desktop/`)

The `desktop/` directory is a Tauri v2 shell, a thin native wrapper around the hosted web app. `desktop-release.yml` builds macOS (universal `.dmg`), Linux (AppImage) and Windows (NSIS); the `targets` in `tauri.conf.json` are only the local default. Each platform uses its system webview: WKWebView on macOS, WebKitGTK on Linux, WebView2 on Windows. Most native work and testing so far is macOS. Keep in mind:

- **Separate build pipeline.** Desktop is built and released by `desktop-release.yml` when the `version` in `src-tauri/tauri.conf.json` changes on `prod` (or on a `desktop-v*` tag / manual dispatch), not by the main `deploy.yml`. Don't conflate them.
- **Two signing layers.** Apple Developer ID (Gatekeeper) + a Tauri updater minisign keypair. The private minisign key lives in CI secrets (`TAURI_SIGNING_PRIVATE_KEY`). Never hardcode or log it.
- **IPC security boundary.** The main webview window loads a remote origin and has zero IPC access (no capability grants it). All native escalation happens in Rust directly or from the local bundled pairing windows. Don't add `remote.urls` entries to any capability file for the prod origin.
- **Additive server routes only.** The desktop shell depends on `/auth/pair/*`, `/auth/handoff`, `/link`, `/api/notifications`, `/api/notifications/stream`, and the `/api/notifications/:id/read` + `/:id/rsvp` actions (banner buttons post to them) in `dali-api`. Changes to those routes affect the native app — note that in the PR description.
- **Don't touch signing config** (`src-tauri/tauri.conf.json` `plugins.updater.pubkey`, or `src-tauri/capabilities/`) without flagging it. Signing mismatches break auto-update for all installed clients.
- Desktop dev: `npm install && npm run tauri:dev` from `desktop/`. Requires Rust (stable) plus the platform toolchain (Xcode Command Line Tools on macOS).

## Scope discipline

- Don't add features, refactors, or abstractions beyond what the issue asks for.
- **Every change ships with tests.** A new feature gets tests for all of its behavior: access checks, validation and rejection paths, what gets written, and the edge cases. A bug fix gets a regression test that fails without the fix and passes with it.
- **Fewer comments, more tests.** If code must behave a specific way, write a test that asserts it, not a comment that describes it. Tests prevent regressions; comments drift and go stale. The codebase has too many comments and too many testing gaps, so the default for new code is no comments. When you touch a file, delete comments that describe behavior and cover that behavior with tests instead. Keep a comment only for a non-obvious *why* that no test can capture, and keep it to one line where you can.
- **Learn behavior from the code and the tests, not the comments.** To find out what code does, read the code and its tests. Treat comments as possibly out of date, never as the source of truth.
- Don't introduce new dependencies to solve something the existing stack already handles.
- Adhere to DRY principles, add what is needed for the issue and not more
- **Reuse existing components before building a new one.** Search `app/components/` (and `app/components/ui/`) for what you need first — the app already ships shared primitives: `Button` / `IconButton`, `SearchInput` (search/filter boxes), `Select` / `MultiSelect` / `Combobox` / `Menu` / `ContextMenu` / `Popover` / `Tooltip` (`ui/floating`), `Checkbox` / `Radio` / `Toggle` / `ToggleChip`, `Segmented`, `DateField` / `TimeField`, `FormField` and `modal-fields`, `filter-panel`, `Card`, `Drawer`, `Pager`, `Modal`, and `useDialog()` / `useToast()` / `useConfirmSubmit()` for confirm/alert/prompt. Extend the shared component (e.g. add a size or variant prop) rather than hand-rolling a one-off — one-offs drift from the design system and are exactly what causes visual inconsistency. Native form controls (`<input>`, `<select>`, `window.confirm`) are not the convention for new UI.
