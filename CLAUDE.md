# CLAUDE.md

Project conventions for Claude when running inside `anthropics/claude-code-action` workflows on this repo.

## Stack

- **App**: `dali-api/` — React Router 7 (full-stack), TypeScript, React 19.
- **DB**: Postgres 16 via Prisma 7 ORM. Hosted on Neon (serverless). Adapters: `@prisma/adapter-neon` (prod-ish), `@prisma/adapter-pg` (local).
- **Realtime collab**: Hocuspocus server + Yjs CRDT + Tiptap editor.
- **Auth**: Google OAuth, Dartmouth CAS, JWT via `jose`.
- **Styling**: Tailwind CSS 4.
- **Deploy**: Fly.io. Branches: `dev` → `staging` → `prod`. Migrations require `DIRECT_URL` (non-pooled Neon endpoint) in addition to pooled `DATABASE_URL` — see `dali-api/prisma/MIGRATIONS.md`.
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

- PRs target `dev`, not `main` or `prod`.
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

- The `@tiptap/*`, `@hocuspocus/*`, and `yjs` bits are CRDT-based. Schema changes to collaboratively edited documents need extra care — tests may pass locally but break document sync in production. Flag any such change in the PR description.

## Operating rules when running in CI

- **Never use `--no-verify`, `--no-gpg-sign`, or any git flag that bypasses hooks.**
- **Never force-push `dev`, `staging`, `prod`, or `main`.** Force-push to your own `claude/issue-*` branch is fine if needed.
- **Don't modify files under `.github/workflows/`** unless the task explicitly asks you to. CI pipeline changes are out of scope for ordinary issues.
- **Don't touch `prisma/migrations/` to "fix" a migration error.** Fix the schema or the seed instead, and regenerate a new migration.
- **When a CI failure is ambiguous or forces a real tradeoff, stop and leave a PR comment explaining the options.** Do not guess. Handing work back with a written explanation is a valid outcome.
- **When you push a fix, leave a PR comment** that summarizes what changed, keyed to the failing check or review point it addresses. Keep it short.

## Scope discipline

- Don't add features, refactors, or abstractions beyond what the issue asks for.
- Don't add comments explaining what well-named code does. Only comment the non-obvious *why*.
- Don't introduce new dependencies to solve something the existing stack already handles.
