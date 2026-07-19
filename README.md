# DALI OS

Internal operations platform for DALI Lab. Single React Router 7 app (`dali-api/`) that serves the UI, the JSON API, and the Hocuspocus realtime collab server. Currently supports hiring, projects, members, partners, calendar, and education. 

## Stack

| Layer | Tech |
|---|---|
| App | React Router 7 (full-stack), React 19, TypeScript |
| DB | Postgres 16 on Neon, Prisma 7 (`@prisma/adapter-neon` / `@prisma/adapter-pg`) |
| Realtime | Hocuspocus + Yjs + Tiptap, Redis for fan-out |
| Auth | Google OAuth, Dartmouth CAS, opaque session cookies + Bearer headers |
| Styling | Tailwind CSS 4 |
| Runtime | Node 22, npm |
| Tests | Vitest (unit), Playwright (e2e) |
| Deploy | Fly.io, branches `staging` → `prod` |

## Repo layout

```
dali-api/
  app/
    hiring/             cycles, reviewers, interviews, delibs, decisions
    admin-console/      members, domains, role assignment
    projects/           project workspaces, epics, sprints, tasks
    members/            directory, user profiles
    partners/           partner portal
    calendar/           scheduling, meetings
    education/          miniseries, workshops, enrollment
    internal-processes/ lab-wide processes and documentation
    slack/              Slack integration
    mcp/                MCP (model context protocol) integration
    collab/             Hocuspocus server + Yjs persistence
    routes/             shared routes (auth, portal, oauth, uploads)
    components/         shared UI
    hooks/              shared React hooks
    forms/              shared form primitives
    lib/                db client, auth, server utilities
  prisma/               schema.prisma, migrations/, seed.ts
  e2e/                  Playwright specs
desktop/                Tauri v2 macOS desktop shell
.github/workflows/      CI/CD
docker-compose.yml      local Postgres + API + Prisma Studio
```

## Local dev

Prereqs: Docker, Node 22, and `dali-api/.env` populated from `dali-api/.env.example`.

```bash
docker compose up
```

Brings up Postgres, runs `prisma db push --force-reset && prisma db seed`, then starts the dev server on `:3001`, the collab server on `:3002`, and Prisma Studio on `:5555`.

Bare metal (your own Postgres):

```bash
cd dali-api
npm install
npm run db:reset:local   # destroys local DB
npm run dev
```

Skip login during dev at `/dev-login` (dev-only route, gated to non-prod builds).

## Commands

Run from `dali-api/`.

| Task | Command |
|---|---|
| Unit tests | `npm test` |
| E2E tests | `npm run test:e2e` (needs a seeded Postgres) |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |
| Dev server | `npm run dev` |
| Reset local DB | `npm run db:reset:local` |

No ESLint/Prettier is wired up.

## Environments

| Env | Branch | Fly app | Neon branch | DB on deploy |
|---|---|---|---|---|
| Staging | `staging` | `dali-api-staging` | `staging` | restore from prod → migrate |
| Prod | `prod` | `dali-api-prod` | `production` | migrate only |

Promotion is staged: PRs merge to `staging`, then `promote-to-prod.yml` moves code to `prod` (a `/push` comment from a write-access user on a staging → prod PR). Per-PR previews spin up their own Neon branch + Fly app via `preview-deploy.yml` and tear down on close.

## Database & migrations

Authoring rules:

- Edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <change>`.
- Commit schema and migration in the same PR.
- Never edit or delete an applied migration. Fix forward with a new one.
- Flag data-losing migrations (drops, non-null without default) in the PR description.

Runtime uses the pooled `DATABASE_URL`. `prisma migrate` needs a non-pooled URL (advisory locks don't survive PgBouncer transaction pooling); `prisma.config.ts` auto-derives it from `DATABASE_URL` or honors an explicit `DIRECT_URL`. Full detail: `dali-api/prisma/MIGRATIONS.md`.

## CI gates

Failures on these block merge:

- `test.yml` — Vitest + Playwright against a real Postgres service container.
- `build-check.yml` — Docker build via flyctl.
- `migration-check.yml` — schema/migration drift, deleted-migration guard, pgfence safety analysis.
- `codeql.yml` — static security scan.
- `preview-deploy.yml` — per-PR Neon + Fly preview (only blocks if it fails specifically).

## Auth surface

- `/login` — Google OAuth or Dartmouth CAS.
- `/portal/*` — applicant portal (lighter layout, no internal nav).
- `/oauth/*` — DALI OS acts as an OAuth provider for the `dali-os-mcp` integration (`authorize`, `token`, `revoke`, `callback/*`).
- Browser auth uses the `__dali_sid` HttpOnly cookie; API/MCP clients send `Authorization: Bearer <session_id>`. Both resolve to one indexed lookup against the `Session` table (`app/lib/session.ts`). See `SESSION_AUTH_PLAN.md` for the model. Never log session ids, OAuth codes, or `.env` contents.

## Realtime / collab

Tiptap documents are CRDT-synced through the Hocuspocus server (`app/collab/server.ts`) using Yjs, with Redis for multi-instance fan-out and Postgres for persistence. Schema changes to collaboratively edited documents can pass tests locally and still break document sync in prod — flag any such change in the PR description.

## Desktop app

`desktop/` is a Tauri v2 cross platform shell that wraps the live hosted web app. It adds native notifications, auto-update, a tray icon, device-pairing sign-in (Google blocks embedded webviews), and deep-link click-through. The web server is unchanged except for additive `/auth/pair/*`, `/auth/handoff`, and `/link` routes.

Releases are tagged `desktop-v*` and built by `desktop-release.yml` — the CI signs with Apple Developer ID and a Tauri updater minisign keypair. See `desktop/README.md` for the full security model and provisioning checklist.

## Pointers

- `CLAUDE.md` — conventions for Claude-driven PRs.
- `CONTRIBUTING.md` — setup and workflow guide for contributors.
- `dali-api/prisma/MIGRATIONS.md` — full migration/Neon URL detail.
- `dali-api/README.md` — deploy detail + per-endpoint rate limits.
- `desktop/README.md` — Tauri shell: security model, signing, release process.
