# CLAUDE.md

Project conventions for Claude when running inside `anthropics/claude-code-action` workflows on this repo.

## Stack

- **App**: `dali-api/` — React Router 7 (full-stack), TypeScript, React 19.
- **DB**: Postgres 16 via Prisma 7 ORM. Hosted on Neon (serverless). Adapters: `@prisma/adapter-neon` (prod-ish), `@prisma/adapter-pg` (local).
- **Realtime collab**: Hocuspocus server + Yjs CRDT + BlockNote editor (one shared `<DocEditor>` in `dali-api/app/components/doc/`, capability presets in `features.ts`). Legacy TipTap-era content converts lazily on load (`app/collab/persistence.ts`); server reads go through `app/collab/read.ts`.
- **AI (docs)**: BlockNote writing assistant at `POST /api/ai/doc` — provider from `ANTHROPIC_API_KEY` (first-party) or `DARTMOUTH_CHAT_API_KEY` (Dartmouth Chat gateway, same Anthropic SDK via `resolveAiProvider()` in `app/lib/ai.server.ts`); per-user rate limits (in-memory burst + Postgres `AiUsage` daily quota) with token usage on the same table (Admin → AI Usage). Surfaces opt in per-mount via the `aiEnabled` prop on `DocEditor`.
- **Background jobs**: in-process 60s runner (`dali-api/app/jobs/`), cross-machine dedup via a Postgres CAS lease on `ScheduledJob` rows (no Redis). Per-job toggles/intervals/settings live in Admin → Jobs.
- **Notifications**: three channels (in-app, email/digest, Slack DM) dispatched by `notify()` per user preference — see "Background jobs & notifications" below. The desktop app layers native banners on the in-app feed: gated per event by the `desktop` sub-preference and flagged urgent via registry `timeSensitive`, resolved at feed-read time (`/api/notifications`), with `/api/notifications/stream` (SSE) for live delivery.
- **Auth**: Google OAuth, Dartmouth CAS, JWT via `jose`.
- **Styling**: Tailwind CSS 4.
- **Deploy**: Fly.io. Branches: `staging` → `prod`. Migrations require `DIRECT_URL` (non-pooled Neon endpoint) in addition to pooled `DATABASE_URL` — see `dali-api/prisma/MIGRATIONS.md`.
- **Package manager**: npm. Node 22.

## Commands (run from `dali-api/`)

| Task | Command |
|---|---|
| Install deps | `npm install` |
| Unit tests | `npm test` (Vitest) |
| E2E tests | `npm run test:e2e` (Playwright — needs seeded Postgres) |
| Typecheck | `npm run typecheck` (runs `react-router typegen && tsc`) |
| Build | `npm run build` |
| Dev server | `npm run dev` |
| Seed DB (dangerous, local only) | `npm run db:reset:local` |

No ESLint/Prettier script is wired up today — don't invent lint commands.

## Branching & PRs

- PRs target `staging`, not `main` or `prod`.
- `prod` deploys come from staged promotion, not direct merges.
- Claude's branches use the prefix `claude/issue-<N>`.

## CI workflows that will gate your PRs

These live in `.github/workflows/` — treat their failures as blocking:
- `test.yml` — Vitest unit tests + Playwright E2E against a real Postgres service container.
- `build-check.yml` — Docker build validation via flyctl.
- `migration-check.yml` — Prisma migration safety: no schema drift, no deleted applied migrations, pgfence safety analysis.
- `codeql.yml` — static security scanning.
- `preview-deploy.yml` — per-PR Neon branch + Fly app (don't worry about this one unless it's failing specifically).

## Migration rules

- **Never hand-edit an applied migration file.** If schema needs to change, add a new migration.
- **Never delete an applied migration file.** `migration-check.yml` enforces both of these.
- Data-losing migrations (drops, non-null without default on populated columns, etc.) should be flagged in the PR description rather than pushed quietly.
- If `migration-check` fails, read its output — it names the offending migration.

## Auth & data handling

- Do not log auth tokens, JWTs, OAuth codes, session cookies, or CAS tickets.
- Do not echo `JWT_SECRET`, `DATABASE_URL`, or anything from `dali-api/.env*` into PR comments, issue comments, or workflow output.
- Don't add routes that return the full user table or bypass role checks.

## Realtime / collab caveats

- The `@blocknote/*`, `@hocuspocus/*`, and `yjs` bits are CRDT-based. Schema changes to collaboratively edited documents need extra care — tests may pass locally but break document sync in production. Flag any such change in the PR description.
- `@tiptap/*` remains a dependency ONLY for the legacy decode layer (`dali-api/app/collab/legacy/` reads pre-BlockNote `"default"` fragments forever) — don't remove it, and don't use it for new editor work.
- Never decode a live Y.Doc server-side without cloning it first — y-prosemirror deletes content it can't decode and Hocuspocus broadcasts the deletion (`persistence.ts` enforces the clone rule).

## Background jobs & notifications

- **Adding a job**: write a handler and add one entry to `dali-api/app/jobs/registry.ts` — the DB row, admin-panel row, and tick pickup all follow. The `ScheduledJob` row is authoritative for interval/settings once created (operator-edited in Admin → Jobs); the registry only seeds defaults. Handlers must be idempotent (the lease recovers crashes by re-running) and keep per-tick work bounded well under the 5-minute lease.
- **Adding a notification type**: add one entry to `app/lib/notification-events.ts` and dispatch via `notify()` (`app/lib/notify.server.ts`) — **never write `prisma.notification` directly** for member-facing notifications; the settings page, preference matching, and digest grouping all derive from the registry. Pick defaults that preserve behavior for users with no preference rows. Renaming an `eventType` requires backfilling both `Notification` and `NotificationPreference`.
- **Outbound gating**: `sendEmail` handles env safety itself (dev skips, staging redirects to the test inbox); Slack DMs are prod-only (`NOTIFY_SLACK_DM_OVERRIDE=1` to test). Applicant/portal/partner transactional email stays on its direct per-feature pipelines, outside the preference layer.
- Manual trigger: `POST /internal/jobs/tick` (`x-jobs-secret` header or an Admin session), or Run-now in Admin → Jobs. Digest jobs self-gate on wall clock — Run-now outside the send window is a no-op by design.

## Operating rules when running in CI

- **Never use `--no-verify`, `--no-gpg-sign`, or any git flag that bypasses hooks.**
- **Never force-push `staging`, `prod`, or `main`.** Force-push to your own `claude/issue-*` branch is fine if needed.
- **Don't modify files under `.github/workflows/`** unless the task explicitly asks you to. CI pipeline changes are out of scope for ordinary issues.
- **Don't touch `prisma/migrations/` to "fix" a migration error.** Fix the schema or the seed instead, and regenerate a new migration.
- **When a CI failure is ambiguous or forces a real tradeoff, stop and leave a PR comment explaining the options.** Do not guess. Handing work back with a written explanation is a valid outcome.
- **When you push a fix, leave a PR comment** that summarizes what changed, keyed to the failing check or review point it addresses. Keep it short.

## Desktop app (`desktop/`)

The `desktop/` directory is a Tauri v2 macOS shell — a thin native wrapper around the hosted web app. Keep in mind:

- **Separate build pipeline.** Desktop is built and released by `desktop-release.yml` on `desktop-v*` tags, not by the main `deploy.yml`. Don't conflate them.
- **Two signing layers.** Apple Developer ID (Gatekeeper) + a Tauri updater minisign keypair. The private minisign key lives in CI secrets (`TAURI_SIGNING_PRIVATE_KEY`). Never hardcode or log it.
- **IPC security boundary.** The main WKWebView window loads a remote origin and has zero IPC access (no capability grants it). All native escalation happens in Rust directly or from the local bundled pairing windows. Don't add `remote.urls` entries to any capability file for the prod origin.
- **Additive server routes only.** The desktop shell depends on `/auth/pair/*`, `/auth/handoff`, `/link`, `/api/notifications`, `/api/notifications/stream`, and the `/api/notifications/:id/read` + `/:id/rsvp` actions (banner buttons post to them) in `dali-api`. Changes to those routes affect the native app — note that in the PR description.
- **Don't touch signing config** (`src-tauri/tauri.conf.json` `plugins.updater.pubkey`, or `src-tauri/capabilities/`) without flagging it. Signing mismatches break auto-update for all installed clients.
- Desktop dev: `npm install && npm run tauri:dev` from `desktop/`. Requires Rust (stable) + Xcode Command Line Tools.

## Scope discipline

- Don't add features, refactors, or abstractions beyond what the issue asks for.
- Don't add comments explaining what well-named code does. Only comment the non-obvious *why*.
- Don't introduce new dependencies to solve something the existing stack already handles.
- Adhere to DRY principles, add what is needed for the issue and not more
