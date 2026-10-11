# DALI API

The app. React Router 7 serves the UI and JSON API; the same process runs the Hocuspocus collab server (`:3002`), the MCP server (`/mcp`), and the background job runner. Setup and commands are in the [root README](../README.md).

## Deployment

Deploys to [Fly.io](https://fly.io) via `.github/workflows/deploy.yml` on pushes to `staging` and `prod`. Deploys serialize per branch and never cancel mid-flight (a cancelled `prisma migrate deploy` poisons the next run). Config per environment: `fly.staging.toml`, `fly.prod.toml`, `fly.preview.toml`.

| Environment | Branch | Fly app | Neon branch | DB strategy |
|---|---|---|---|---|
| **Staging** | `staging` | `dali-api-staging` | `staging` | Restore from prod, then migrate |
| **Prod** | `prod` | `dali-api-prod` | `production` | Migrate only |
| **Preview** | PR head | `dali-api-pr-<N>` | `preview-pr-<N>` | Wipe, migrate, seed |

- **Staging**: the Neon branch is restored from production before each deploy, so new migrations run against real data. This catches data-incompatible migrations before prod.
- **Prod**: only new migrations are applied. No seeding.
- **Preview**: wiped on every push. All migrations run from an empty database, then seed. Dev dependencies (`tsx`) ship in the image so the seed can run.

Migrations run as the Fly release command (`npx prisma migrate deploy`). Detail in `prisma/MIGRATIONS.md`.

## Environment

`.env.example` lists every variable. Groups:

| Group | Variables |
|---|---|
| Core | `DATABASE_URL`, `DIRECT_URL` (optional), `BETTER_AUTH_SECRET`, `FRONTEND_URL`, `API_BASE_URL` |
| Auth | `GOOGLE_CLIENT_*`, `GOOGLE_REDIRECT_URI`, `CAS_BASE_URL`, `DARTMOUTH_API_KEY` |
| Google Workspace | `GMAIL_USER`, `GOOGLE_WORKSPACE_*`, `CALENDAR_TOKEN_KEY`, `DALI_GENERAL_CALENDAR_*` |
| Integrations | `SLACK_*`, `GITHUB_*`, `ZOOM_*`, `AWS_*` |
| AI | `ANTHROPIC_API_KEY` or `DARTMOUTH_CHAT_API_KEY` |
| Jobs | `JOBS_TICK_SECRET`, `NOTIFY_SLACK_DM_OVERRIDE` |
| Wallet | `WALLET_PASS_SECRET`, `APPLE_PASS_*`, `GOOGLE_WALLET_*` (see `app/wallet/SETUP.md`) |
| Transcription | `DIARIZE_URL`, `DIARIZE_SECRET` (see `../asr/README.md`) |
| Collab | `REDIS_URL` (optional, multi-machine fan-out), `COLLAB_PORT` |

## Rate limits

`checkRateLimit()` in `app/lib/rate-limit.ts` is an in-memory sliding window, per process. Keys default to client IP; call sites pass a user, session, or grant key after auth. IP tiers are generous because eduroam shares public IPs.

| Endpoint | Key | Limit |
|---|---|---|
| `/login` (CAS/OAuth start, code send) | IP | 5 / min |
| `/oauth/authorize` | IP | 10 / min |
| `/oauth/register` | IP | 5 / hour |
| `/auth/pair/poll` | IP, then device code | 60 / min, 1 / 3s |
| `/partner/login` and magic links | IP, then email | 5 / min; 5 / 10 min and 3 / 15 min |
| `/api/room-display/activate` | IP | 10 / 10 min |
| `/mcp` | OAuth grant | 120 / min |
| `/api/check-url` | user | 20 / min |
| `/api/upload/presign` | user | 20 / min |
| `/api/email/send` | user | 100 / min |
| `/api/ai/doc`, `/api/ai/email` | user | 10 / min burst, plus a daily token quota on `AiUsage` |
| `/api/analytics/error` | session | 20 / min |

## Internal endpoints

- `POST /internal/jobs/tick`: run the job tick now. Needs the `x-jobs-secret` header or an Admin session.
- `/dev-login`, `/dev-login-as`: non-prod only.
