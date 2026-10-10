# Contributing to DALI OS

This guide covers how to contribute. For *what* to contribute, check the project task board (maintained in DALI OS) or ask in Slack.

## Getting set up

See the [README](README.md) for local dev setup, commands, and environments. Each PR gets an ephemeral Neon branch + Fly app, torn down on close or merge.

## Branching & PRs

- All PRs target `staging`, not `prod`.
- Branch names: `feat/<short-description>` or `fix/<short-description>`. Claude's branches use `claude/issue-<N>`.
- Write a clear PR description. Call out data-losing migrations, collab schema changes, and changes to the routes the desktop app depends on (`/auth/pair/*`, `/auth/handoff`, `/link`, `/api/notifications*`).

**Promotion to prod**

- Code reaches `prod` via a `staging` → `prod` PR: comment `/push` (write access required) to fast-forward `prod`.
- This is the only way to promote code.

## Database migrations

1. Edit `prisma/schema.prisma`.
2. Run `npx prisma migrate dev --name <descriptive-name>` from `dali-api/`.
3. Commit the schema and migration together in the same PR.

Never modify or delete an applied migration file. Add a new one instead. `migration-check` enforces this.

## Testing

Run these from `dali-api/` before pushing:

- `npm test`: unit tests (Vitest). `npm run test:coverage` adds a V8 report in `coverage/index.html`.
- `npm run typecheck`: always run this; it also regenerates React Router type stubs.
- `npm run test:e2e`: Playwright against a seeded Postgres and a production build (`npm run build` first). Run it when touching routes, auth, or data flows.

`asr/` changes: `cd asr && uv run pytest`.

CI runs all of these. If `test.yml`, `build-check.yml`, `migration-check.yml`, or `codeql.yml` fail, the PR is blocked.

## Conventions

- Reuse shared components from `app/components/` and `app/components/ui/` before building a new one. Native `<select>`, `<input type="checkbox">`, and `window.confirm` are not the convention; use `Select`, `Checkbox`, `Toggle`, `DateField`, `Modal`, and `useDialog()` / `useToast()` / `useConfirmSubmit()`.
- Follow `STYLE_GUIDE.md` for tokens, spacing, and page chrome.
- Feature flags: add one entry to `dali-api/app/lib/feature-flags.ts`, then check `useFeatureFlag("key")` on the client or `isFeatureEnabled(...)` on the server. Targeting (everyone, role, specific users) is set in **Admin → System & Insights → Feature Flags**. Flags default off.
- Background jobs: write a handler and add an entry to `app/jobs/registry.ts`. Handlers must be idempotent and finish well under the 5-minute lease.
- Notifications: add an entry to `app/lib/notification-events.ts` and dispatch through `notify()`. Never write `prisma.notification` directly.
- Outbound email goes through `enqueueOutbound()` in `app/lib/outbound.server.ts`, not raw `sendEmail`.
- Collab docs: never decode a live Y.Doc server-side without cloning it first. Don't use `@tiptap/*` for new editor work; it exists only to decode legacy content.

## Security ground rules

- Never log auth tokens, JWTs, OAuth codes, session cookies, or CAS tickets.
- Never commit `.env` values or secrets.
- Never add routes that return the full user table or bypass role checks.

## Native clients

- `desktop/` has its own flow; see `desktop/README.md`. Releases cut from a version bump in `src-tauri/tauri.conf.json` once promoted to `prod`. Don't touch `desktop-release.yml` or the signing config (`plugins.updater.pubkey`, `src-tauri/capabilities/`) without flagging it.
- `ios/` builds in Xcode; see `ios/README.md`. Bump `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in every PR that changes it.
- `asr/` deploys to Modal on push to `staging` or `prod`; see `asr/README.md`.
