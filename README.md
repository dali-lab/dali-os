# DALI OS

Internal operations platform for DALI Lab. One React Router 7 app (`dali-api/`) serves the UI, the JSON API, the MCP server, and the Hocuspocus realtime collab server. Native clients (desktop, iOS, two Chrome extensions) and a Modal transcription service live alongside it in this repo.

Covers hiring, projects and sprints, members and mentorship, partners, calendar and rooms, education, Drive (docs and files), signing, payroll, and lab-wide notifications.

## Stack

| Layer | Tech |
|---|---|
| App | React Router 7 (full-stack), React 19, TypeScript |
| DB | Postgres 16 on Neon, Prisma 7 (`@prisma/adapter-neon` in deploys, `@prisma/adapter-pg` locally) |
| Realtime | Hocuspocus + Yjs, BlockNote editor. Redis fan-out is optional (`REDIS_URL`), needed only for multi-machine sync |
| AI | Anthropic SDK, first-party key or the Dartmouth Chat gateway (`app/lib/ai.server.ts`) |
| Auth | Google OAuth, Dartmouth CAS, session cookie + Bearer. BetterAuth migration behind the `betterauth` flag |
| Jobs | In-process 60s runner, Postgres lease for cross-machine dedup (no Redis) |
| Styling | Tailwind CSS 4, design system in `STYLE_GUIDE.md` |
| Runtime | Node 22, npm |
| Tests | Vitest (unit), Playwright (e2e), pytest (`asr/`) |
| Deploy | Fly.io, branches `staging` → `prod`. Modal for `asr/` |

## Repo layout

```
dali-api/               the app (see dali-api/README.md)
  app/
    hiring/             cycles, reviewers, interviews, delibs, decisions
    projects/           project workspaces, epics, sprints, tasks
    members/            directory, profiles
    mentorship/         pairs, mentor notes
    partners/           partner CRM + partner portal
    calendar/           meetings, scheduling, timesheet
    rooms/              room bookings, iPad door displays
    education/          offerings, sessions, assignments
    signing/            agreements and e-signatures
    activities/         time-boxed lab activities
    core/               Core hub: process-level admin (hiring, comms, staffing)
    admin/              Admin hub: system-level admin (payroll, access, flags, jobs)
    internal-processes/ lab-wide process pages
    email/              templates, senders, outbound messages
    jobs/               background job handlers + registry
    collab/             Hocuspocus server, Yjs persistence, legacy TipTap decode
    mcp/                MCP tools, resources, prompts
    public-api/         unauthenticated endpoints for the public site
    slack/              bug-report bot + Slack DM delivery
    wallet/             Apple/Google wallet passes (see wallet/SETUP.md)
    routes/             auth, portal, oauth, uploads, notifications, AI
    components/ hooks/ forms/ lib/ types/   shared code
  prisma/               schema.prisma, migrations/, seed.ts
  e2e/                  Playwright specs
  docs/                 setup notes for specific pipelines
asr/                    Modal app: meeting transcription + diarization (Python, uv)
desktop/                Tauri v2 shell (macOS, Linux, Windows)
ios/                    SwiftUI app (iPad room display, iPhone placeholder)
jobx-extension/         Chrome extension: fill JobX timesheets from DALI OS
dali-timesheet/         Older Chrome extension for the same job
specs/                  design docs; specs/archive/ holds superseded plans
.github/workflows/      CI/CD
docker-compose.yml      local Postgres + app + Prisma Studio
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
npx prisma generate
npm run db:reset:local   # destroys local DB
npm run dev
```

Skip login during dev at `/dev-login` (non-prod builds only).

## Commands

Run from `dali-api/`.

| Task | Command |
|---|---|
| Unit tests | `npm test` |
| Coverage | `npm run test:coverage` |
| E2E tests | `npm run test:e2e` (needs a seeded Postgres and a prior `npm run build`) |
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
| Preview | PR head | `dali-api-pr-<N>` | `preview-pr-<N>` | wipe → migrate → seed |

PRs merge to `staging`. `promote-to-prod.yml` fast-forwards `prod` when a write-access user comments `/push` on a staging → prod PR. Previews come from `preview-deploy.yml` and tear down on close. `deploy-asr.yml` deploys `asr/` to Modal on pushes to either branch that touch it.

## Database & migrations

- Edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <change>`.
- Commit schema and migration in the same PR.
- Never edit or delete an applied migration. Fix forward with a new one.
- Flag data-losing migrations (drops, non-null without default) in the PR description.

Runtime uses the pooled `DATABASE_URL`. `prisma migrate` needs a non-pooled URL; `prisma.config.ts` derives it from `DATABASE_URL` or honors an explicit `DIRECT_URL`. Full detail: `dali-api/prisma/MIGRATIONS.md`.

## CI gates

Failures on these block merge:

- `test.yml`: Vitest + Playwright against a Postgres service container, plus `asr/` pytest. Unit coverage lands in the run summary and the `coverage-report` artifact.
- `build-check.yml`: Docker build via flyctl.
- `migration-check.yml`: schema drift, deleted-migration guard, pgfence safety analysis.
- `codeql.yml`: static security scan.
- `preview-deploy.yml`: per-PR Neon + Fly preview (blocks only when it fails on its own).

`claude.yml`, `claude-ci-fix.yml`, and `claude-auto-merge.yml` run Claude on issues and PRs; their conventions are in `CLAUDE.md`.

## Auth surface

- `/login`: Google OAuth or Dartmouth CAS for lab members.
- `/portal/*`: applicant and student portal (hiring applications, education offerings).
- `/partner/*`: partner portal, magic-link sign-in.
- `/oauth/*`: DALI OS is an OAuth provider for MCP clients (`authorize`, `token`, `revoke`, `register`).
- `/auth/pair/*`, `/auth/handoff`: device pairing for the desktop app and extensions.
- `/api/public/*`: unauthenticated data for the public website.

Browser auth uses the `__dali_sid` HttpOnly cookie; API and MCP clients send `Authorization: Bearer <session_id>`. Both resolve to one lookup against the `Session` table (`app/lib/session.ts`). Never log session ids, OAuth codes, or `.env` contents.

## Realtime / collab

Documents are CRDT-synced through the Hocuspocus server (`app/collab/server.ts`) using Yjs, with Postgres for persistence and Redis for fan-out when `REDIS_URL` is set. The editor is BlockNote; TipTap stays a dependency only to decode pre-BlockNote content in `app/collab/legacy/`. Never decode a live Y.Doc server-side without cloning it first. Schema changes to collaboratively edited documents can pass tests locally and still break sync in prod. Flag them in the PR description.

## Jobs, notifications, flags

- Background jobs: one handler plus one entry in `app/jobs/registry.ts`. Intervals and settings are edited in Admin → Jobs.
- Notifications: one entry in `app/lib/notification-events.ts`, dispatched through `notify()`. Channels are in-app, email digest, Slack DM, and desktop banners.
- Feature flags: one entry in `app/lib/feature-flags.ts`, targeting edited in Admin → Feature Flags. Flags default off.

## Native clients

- `desktop/`: Tauri v2 shell around the hosted app. Native notifications, tray, auto-update, device-pairing sign-in. Releases cut from a version bump on `prod` via `desktop-release.yml`. See `desktop/README.md`.
- `ios/`: SwiftUI iPad door display and wallet-pass check-in. See `ios/README.md`.
- `jobx-extension/`: Chrome extension that fills Dartmouth JobX timesheets from logged hours. See its README.

## Pointers

- `CLAUDE.md`: conventions for Claude-driven PRs.
- `CONTRIBUTING.md`: workflow for contributors.
- `STYLE_GUIDE.md`: the dali.os design system as it lives in code.
- `dali-api/README.md`: deploy detail and rate limits.
- `dali-api/prisma/MIGRATIONS.md`: migration and Neon URL detail.
- `dali-api/docs/ONBOARDING_PROVISIONING.md`: what runs when an applicant is accepted.
- `specs/`: design docs. `specs/feature-status.md` tracks what is shipped.
