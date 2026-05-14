# Slack bug-report bot

Webhook receiver embedded in `dali-api`. First feature: a teammate `@dali-slack file-this` inside a Slack thread → bot posts a preview reply → a `:white_check_mark:` reaction by an allowed user files the thread as a GitHub issue on `dali-lab/dali-os`.

## Files

- `routes/api.slack.events.ts` — Events API webhook (`POST /api/slack/events`). Verifies signature, dispatches `app_mention` and `reaction_added`.
- `routes/api.slack.interactivity.ts` — Stub for buttons/modals later (`POST /api/slack/interactivity`). Currently just signature-verifies.
- `lib/verify-signature.ts` — Slack v0 HMAC-SHA256 signature check + 5-minute replay window.
- `lib/slack-client.ts` — Thin `@slack/web-api` wrapper.
- `lib/handle-mention.ts` — Reacts to `@dali-slack file-this` in a thread; posts preview, persists draft.
- `lib/handle-reaction.ts` — On `:white_check_mark:` files via GitHub App; on `:x:` cancels.
- `lib/format-issue.ts` — Pure function: thread + uploaded images → issue title/body.
- `lib/github-app.ts` — Octokit + `@octokit/auth-app` wrapper for issue creation and asset upload.

## Required env vars (see `dali-api/.env.example`)

| Var | Notes |
|---|---|
| `SLACK_SIGNING_SECRET` | Slack app → Basic Information → Signing Secret. Empty disables both endpoints (503). |
| `SLACK_BOT_TOKEN` | `xoxb-…` from OAuth & Permissions. |
| `SLACK_ALLOWED_REACTOR_IDS` | Optional comma-separated Slack user IDs allowed to confirm-file. Empty = any user. |
| `GITHUB_APP_ID` | Public, not a secret. |
| `GITHUB_APP_INSTALLATION_ID` | Visible in the app's installation page URL. |
| `GITHUB_APP_PRIVATE_KEY` | PEM. In Fly use a literal newline `\n` between lines; we decode `\n` → `\n` automatically. |
| `GITHUB_ISSUES_REPO` | `owner/repo`. Default `dali-lab/dali-os`. |
| `GITHUB_ISSUE_ASSETS_REPO` | `owner/repo`. We commit Slack image uploads here under `slack-uploads/<sha>/<name>` and embed the `raw.githubusercontent.com` URL in the issue. |

## One-time Slack app setup

1. Create at https://api.slack.com/apps.
2. **Bot Token Scopes**: `app_mentions:read`, `channels:history`, `chat:write`, `files:read`, `reactions:read`, `reactions:write` (add `groups:history` for private channels).
3. **Event Subscriptions** → enable. Request URL per env:
   - dev: `https://dali-api-dev.fly.dev/api/slack/events`
   - staging: `https://dali-api-staging.fly.dev/api/slack/events`
   - prod: `https://dali-api-prod.fly.dev/api/slack/events`
   Subscribed events: `app_mention`, `reaction_added`.
4. **Interactivity & Shortcuts** → enable. Request URL: `…/api/slack/interactivity` (same hosts).
5. Install to workspace. Invite the bot to your bug-report channel.

Slack will verify the request URL once on save — the route returns the `challenge` token automatically.

## One-time GitHub App setup

1. Create at https://github.com/organizations/dali-lab/settings/apps/new.
2. Permissions:
   - Repository → Issues: **Read & write**
   - Repository → Contents: **Read & write** (for image asset commits)
3. Install on `dali-lab/dali-os` and `dali-lab/dali-issue-assets`.
4. Generate a private key (`.pem` download). Store as `GITHUB_APP_PRIVATE_KEY` Fly secret.
5. The installation ID is in the install URL (`/settings/installations/<id>`).

## Local dev with ngrok

```bash
cd dali-api && npm run dev
# in another shell:
ngrok http 3000
# put the https://*.ngrok-free.app URL in Slack's Events Request URL + Interactivity URL
```

The bot won't do anything unless `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, and the GitHub App env vars are set.

## Smoke test checklist

1. `@dali-slack file-this` in a thread → bot replies in-thread with a preview within ~5s.
2. React `:white_check_mark:` → preview edits to `:white_check_mark: Filed as <link>` within ~5s. New issue exists.
3. React `:x:` on a fresh preview → preview edits to `_Cancelled by @user._`. No issue filed.
4. Force a failure (e.g. revoke the GitHub App's repo install) → preview shows `:warning: Failed to file: …` and the draft row is `Failed`. Re-react `:white_check_mark:` retries.

## What's not done

- No automatic stale-draft cleanup (drafts in `Pending` never expire).
- No retry queue for transient GH 5xx — the user must re-react.
- No channel→repo routing. Every issue lands in `GITHUB_ISSUES_REPO`.
- No interactivity buttons yet; the route is just a verified 200.
