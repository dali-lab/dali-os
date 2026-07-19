# Contributing to DALI OS

This guide covers how to contribute to the project. If you're curious about *what* to contribute check out our project task board (maintained in DALI OS) or ask in Slack!

## Getting set up

See the [README](README.md) for the full local dev setup, commands, and environment details.

**PR-deploys** — each PR spins up an ephemeral Neon branch + Fly app, torn down on close or merge.

## Branching & PRs

- All PRs target `staging`, not `prod`.
- Branch names: `feature/<short-description>` or `fix/<short-description>`.
- Write a clear PR description. If the PR touches the DB schema, call out any data-losing operations (drops, non-null columns without a default) explicitly.

**Promotion to prod**

- Code reaches `prod` via a `staging` → `prod` PR: comment `/push` (write access required) to fast-forward `prod`.
- This is the only way to promote code to `prod`.

## Database migrations

1. Edit `prisma/schema.prisma`.
2. Run `npx prisma migrate dev --name <descriptive-name>` from `dali-api/`.
3. Commit the schema and migration together in the same PR.

**Never modify an applied migration file** — if something needs fixing, add a new migration. `migration-check` enforces this.

If your change touches collaboratively edited documents (Tiptap/Yjs), flag it in the PR description — schema changes there can pass tests locally and still break sync in production.

## Testing

Run these before pushing:

- `npm test` — unit tests (Vitest).
- `npm run typecheck` — always run this; it also regenerates React Router type stubs.
- `npm run test:e2e` — Playwright against a real seeded Postgres. You don't need it for every change, but run it when touching routes, auth, or data flows.

CI runs all three against a real Postgres service container. If `test.yml`, `build-check.yml`, `migration-check.yml`, or `codeql.yml` fail, the PR is blocked.

## Security ground rules

- Never log auth tokens, JWTs, OAuth codes, session cookies, or CAS tickets.
- Never commit `.env` values or secrets.
- Never add routes that return the full user table or bypass role checks.

## Desktop app (`desktop/`)

The Tauri application has its own development flow — see `desktop/README.md`. Releases are cut by tagging `desktop-v*`; CI handles signing. Avoid touching `desktop-release.yml` or the signing configuration.
