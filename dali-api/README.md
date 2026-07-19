# DALI API

## Deployment

The API deploys to [Fly.io](https://fly.io) via GitHub Actions (`.github/workflows/deploy.yml`). There are two environments, plus per-PR preview apps, each with a different database strategy:

| Environment | Branch | Fly App | Neon Branch | DB Strategy |
|---|---|---|---|---|
| **Staging** | `staging` | `dali-api-staging` | `staging` | Restore from prod + migrate |
| **Prod** | `prod` | `dali-api-prod` | `production` | Migrate only |
| **Preview** | PR head | `dali-api-pr-<N>` | `preview-pr-<N>` | Full wipe + migrate + seed |

- **Staging**: The database is restored from the production Neon branch before deploying. New migrations are applied on top of real prod data. This catches data-incompatible migrations before they reach prod.
- **Prod**: Only new Prisma migrations are applied. No database prep or seeding.
- **Preview**: The database is wiped on every push. All Prisma migrations run from scratch on an empty database, then seed data is applied. This ensures migrations are always valid from a clean slate. Dev dependencies (like `tsx`) are included in the Docker image so the seed script can run.

## Rate Limits

All windows are 60 seconds. Limits are generous on IP-based tiers because users may share a public IP via eduroam.

| Endpoint | Tier | Key | Limit | Purpose |
|---|---|---|---|---|
| `api.check-url` | 1 (pre-auth) | IP | 200/60s | DoS guard |
| `api.check-url` | 2 (post-auth) | User ID | 20/60s | Per-user fairness |
| `api.hiring.cycles.$cycleId.book-interview` | post-auth | User ID | 5/60s | Per-user fairness |
| `oauth.token` | pre-auth | IP | 200/60s | Brute-force protection |
